import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  approveRequest,
  listPending,
  verifyApprovalToken,
  generateApprovalToken,
} from "./approval.js";

/**
 * Lightweight HTTP server for Human-in-the-Loop approval.
 * Runs as a separate process from the policy engine.
 *
 * Endpoints:
 *   POST /approve/:id  — Approve a pending request (requires Bearer token)
 *   GET  /pending       — List pending approvals
 *   GET  /health        — Health check
 *
 * SECURITY: Operator endpoints require a dedicated Bearer token (HITL_OPERATOR_TOKEN).
 * Optional x-approval-token adds per-approval verification as defense in depth.
 *
 * KNOWN LIMITATION: No TLS. In production, place behind a reverse proxy with TLS termination.
 * KNOWN LIMITATION: No rate limiting. In production, add rate limiting to prevent brute-force.
 */

const PORT = Number(process.env["APPROVAL_SERVER_PORT"] ?? "3001");
const OPERATOR_TOKEN = process.env["HITL_OPERATOR_TOKEN"];

if (!OPERATOR_TOKEN) {
  throw new Error("HITL_OPERATOR_TOKEN is required for approval-server");
}

// Fail fast if HITL_HMAC_SECRET is missing/insecure.
generateApprovalToken("startup-check");

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const authHeader = req.headers["authorization"] ?? "";
  const expected = `Bearer ${OPERATOR_TOKEN}`;
  if (authHeader.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
}

const MAX_BODY_BYTES = 4096;

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new HttpError(413, "Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function createApprovalServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      // GET /health
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { status: "ok" });
        return;
      }

      // GET /pending
      if (req.method === "GET" && url.pathname === "/pending") {
        if (!isAuthorized(req)) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }
        const pending = listPending();
        // Include approval tokens so the operator can use them
        const withTokens = pending.map((p) => ({
          ...p,
          approval_token: generateApprovalToken(p.id),
        }));
        json(res, 200, { pending: withTokens });
        return;
      }

      // POST /approve/:id
      const approveMatch = url.pathname.match(/^\/approve\/([a-f0-9-]+)$/);
      if (req.method === "POST" && approveMatch) {
        if (!isAuthorized(req)) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }

        const approvalId = approveMatch[1];

        // Optional per-approval token (defense in depth)
        const approvalTokenHeader = req.headers["x-approval-token"];
        const approvalToken = Array.isArray(approvalTokenHeader)
          ? approvalTokenHeader[0]
          : approvalTokenHeader;
        if (approvalToken && !verifyApprovalToken(approvalId, approvalToken)) {
          json(res, 403, { error: "Invalid approval token" });
          return;
        }

        // Parse optional body for approved_by
        let approvedBy = "operator";
        let body = "";
        try {
          body = await parseBody(req);
        } catch (err) {
          if (err instanceof HttpError) {
            json(res, err.status, { error: err.message });
            return;
          }
          json(res, 400, { error: "Invalid request body" });
          return;
        }

        if (body) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            json(res, 400, { error: "Invalid JSON body" });
            return;
          }

          if (
            parsed &&
            typeof parsed === "object" &&
            "approved_by" in parsed &&
            typeof (parsed as { approved_by: unknown }).approved_by === "string" &&
            (parsed as { approved_by: string }).approved_by.length <= 256
          ) {
            approvedBy = (parsed as { approved_by: string }).approved_by;
          }
        }

        const success = approveRequest(approvalId, approvedBy);
        if (success) {
          json(res, 200, { approved: true, id: approvalId, approved_by: approvedBy });
        } else {
          json(res, 400, { error: "Approval failed — request may be expired, already approved, or not found" });
        }
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      console.error(`[approval-server] Unhandled request error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        json(res, 500, { error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });
}

const shouldAutostart = process.env["APPROVAL_SERVER_AUTOSTART"] !== "false";
if (shouldAutostart) {
  const server = createApprovalServer();
  server.listen(PORT, () => {
    console.log(`[approval-server] Listening on http://localhost:${PORT}`);
    console.log(`[approval-server] Operator auth: Authorization: Bearer <HITL_OPERATOR_TOKEN>`);
    console.log(`[approval-server] Endpoints:`);
    console.log(`  GET  /health     — Health check`);
    console.log(`  GET  /pending    — List pending approvals`);
    console.log(`  POST /approve/:id — Approve a request (Bearer token required)`);
  });
}
