import http from "node:http";
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
 * SECURITY: The Bearer token is an HMAC derived from the approval ID and HITL_HMAC_SECRET.
 * Without the secret, an attacker cannot generate valid tokens.
 *
 * KNOWN LIMITATION: No TLS. In production, place behind a reverse proxy with TLS termination.
 * KNOWN LIMITATION: No rate limiting. In production, add rate limiting to prevent brute-force.
 */

const PORT = Number(process.env["APPROVAL_SERVER_PORT"] ?? "3001");

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }

  // GET /pending
  if (req.method === "GET" && url.pathname === "/pending") {
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
    const approvalId = approveMatch[1];

    // SECURITY: Verify Bearer token
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      json(res, 401, { error: "Missing Authorization: Bearer <token>" });
      return;
    }

    const token = authHeader.slice(7);
    if (!verifyApprovalToken(approvalId, token)) {
      json(res, 403, { error: "Invalid approval token" });
      return;
    }

    // Parse optional body for approved_by
    let approvedBy = "operator";
    try {
      const body = await parseBody(req);
      if (body) {
        const parsed = JSON.parse(body);
        if (parsed.approved_by) approvedBy = parsed.approved_by;
      }
    } catch {
      // Body is optional
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
});

server.listen(PORT, () => {
  console.log(`[approval-server] Listening on http://localhost:${PORT}`);
  console.log(`[approval-server] Endpoints:`);
  console.log(`  GET  /health     — Health check`);
  console.log(`  GET  /pending    — List pending approvals`);
  console.log(`  POST /approve/:id — Approve a request (Bearer token required)`);
});
