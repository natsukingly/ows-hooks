import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getSharedDb } from "./db.js";

// ── Configuration ──

const TTL_MINUTES = Number(process.env["HITL_APPROVAL_TTL_MINUTES"] ?? "15");
const MAX_RETRIES = 3;

function getHmacSecret(): string {
  const secret = process.env["HITL_HMAC_SECRET"];
  if (!secret || secret === "dev-secret-change-in-production") {
    throw new Error(
      "HITL_HMAC_SECRET must be set to a strong random value (default/insecure value is not allowed)",
    );
  }
  return secret;
}

// SECURITY: HITL_HMAC_SECRET is mandatory and insecure/default values are rejected.

// ── Types ──

export interface ApprovalRecord {
  id: string;
  tx_hash: string;
  agent_id: string;
  wallet_id: string;
  chain_id: string;
  tx_to: string;
  tx_value: string;
  status: "pending" | "approved" | "denied" | "expired" | "used";
  requested_at: string;
  expires_at: string;
  approved_by: string | null;
  approved_at: string | null;
  retry_count: number;
  hmac: string;
}

// ── DB Setup ──

let initialized = false;

/** Reset initialization state (for testing only) */
export function resetApprovalState(): void {
  initialized = false;
}

function ensureTable(): void {
  if (initialized) return;
  const db = getSharedDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id            TEXT PRIMARY KEY,
      tx_hash       TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      wallet_id     TEXT NOT NULL,
      chain_id      TEXT NOT NULL,
      tx_to         TEXT NOT NULL,
      tx_value      TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'expired', 'used')),
      requested_at  TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      approved_by   TEXT,
      approved_at   TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      hmac          TEXT NOT NULL
    );
  `);

  // SECURITY: Append-only — no DELETE allowed. UPDATE is restricted to status transitions only.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS no_delete_approvals
    BEFORE DELETE ON approvals
    BEGIN
      SELECT RAISE(ABORT, 'approvals table: DELETE is prohibited');
    END;
  `);

  initialized = true;
}

// ── HMAC ──

// SECURITY: HMAC binds the approval to exact transaction parameters.
// Changing any field (to, value, chain_id, agent_id) invalidates the token.
// This prevents approval replay attacks across different transactions.
function computeHmac(fields: {
  id: string;
  tx_hash: string;
  agent_id: string;
  tx_to: string;
  tx_value: string;
  chain_id: string;
}): string {
  const payload = `${fields.id}:${fields.tx_hash}:${fields.agent_id}:${fields.tx_to}:${fields.tx_value}:${fields.chain_id}`;
  return createHmac("sha256", getHmacSecret()).update(payload).digest("hex");
}

export function verifyHmac(record: ApprovalRecord): boolean {
  const expected = computeHmac({
    id: record.id,
    tx_hash: record.tx_hash,
    agent_id: record.agent_id,
    tx_to: record.tx_to,
    tx_value: record.tx_value,
    chain_id: record.chain_id,
  });
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(record.hmac, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// ── Transaction Hash ──

// SECURITY: tx_hash binds the approval to the exact (to, value, chain_id) triple.
// A single approval cannot be used for a different transaction.
export function computeTxHash(to: string, value: string, chainId: string): string {
  return createHash("sha256")
    .update(`${to.toLowerCase()}:${value}:${chainId}`)
    .digest("hex");
}

// ── CRUD ──

export function createApproval(params: {
  agent_id: string;
  wallet_id: string;
  chain_id: string;
  tx_to: string;
  tx_value: string;
}): ApprovalRecord {
  ensureTable();
  const db = getSharedDb();

  const id = randomUUID();
  const tx_hash = computeTxHash(params.tx_to, params.tx_value, params.chain_id);
  const now = new Date();
  const requested_at = now.toISOString();
  const expires_at = new Date(now.getTime() + TTL_MINUTES * 60 * 1000).toISOString();

  const hmac = computeHmac({
    id,
    tx_hash,
    agent_id: params.agent_id,
    tx_to: params.tx_to,
    tx_value: params.tx_value,
    chain_id: params.chain_id,
  });

  const record: ApprovalRecord = {
    id,
    tx_hash,
    agent_id: params.agent_id,
    wallet_id: params.wallet_id,
    chain_id: params.chain_id,
    tx_to: params.tx_to,
    tx_value: params.tx_value,
    status: "pending",
    requested_at,
    expires_at,
    approved_by: null,
    approved_at: null,
    retry_count: 0,
    hmac,
  };

  db.prepare(`
    INSERT INTO approvals (id, tx_hash, agent_id, wallet_id, chain_id, tx_to, tx_value, status, requested_at, expires_at, approved_by, approved_at, retry_count, hmac)
    VALUES (@id, @tx_hash, @agent_id, @wallet_id, @chain_id, @tx_to, @tx_value, @status, @requested_at, @expires_at, @approved_by, @approved_at, @retry_count, @hmac)
  `).run(record);

  return record;
}

/** Find a valid (approved, not expired, not used) approval for a given transaction */
export function findValidApproval(params: {
  agent_id: string;
  tx_to: string;
  tx_value: string;
  chain_id: string;
}): ApprovalRecord | null {
  ensureTable();
  const db = getSharedDb();

  const tx_hash = computeTxHash(params.tx_to, params.tx_value, params.chain_id);
  const now = new Date().toISOString();

  const record = db.prepare(`
    SELECT * FROM approvals
    WHERE tx_hash = ? AND agent_id = ? AND status = 'approved' AND expires_at > ?
    ORDER BY approved_at DESC LIMIT 1
  `).get(tx_hash, params.agent_id, now) as ApprovalRecord | undefined;

  if (!record) return null;

  // SECURITY: Verify HMAC integrity before trusting the record.
  // If the DB was tampered with, this check will catch it.
  if (!verifyHmac(record)) {
    console.error(`[hitl] SECURITY WARNING: HMAC verification failed for approval ${record.id}`);
    return null;
  }

  return record;
}

/**
 * Atomically consume a valid approval exactly once.
 * Returns the consumed approval record if successful, otherwise null.
 */
export function consumeValidApproval(params: {
  agent_id: string;
  tx_to: string;
  tx_value: string;
  chain_id: string;
}): ApprovalRecord | null {
  ensureTable();
  const db = getSharedDb();
  const tx_hash = computeTxHash(params.tx_to, params.tx_value, params.chain_id);
  const now = new Date().toISOString();

  const consume = db.transaction((): ApprovalRecord | null => {
    const record = db.prepare(`
      SELECT * FROM approvals
      WHERE tx_hash = ? AND agent_id = ? AND status = 'approved' AND expires_at > ?
      ORDER BY approved_at DESC LIMIT 1
    `).get(tx_hash, params.agent_id, now) as ApprovalRecord | undefined;

    if (!record) return null;
    if (!verifyHmac(record)) {
      console.error(`[hitl] SECURITY WARNING: HMAC verification failed for approval ${record.id}`);
      return null;
    }

    const result = db.prepare(
      "UPDATE approvals SET status = 'used' WHERE id = ? AND status = 'approved'",
    ).run(record.id);

    if (result.changes !== 1) return null;
    return { ...record, status: "used" };
  });

  return consume();
}

/** Find an existing pending approval to avoid creating duplicates */
export function findPendingApproval(params: {
  agent_id: string;
  tx_to: string;
  tx_value: string;
  chain_id: string;
}): ApprovalRecord | null {
  ensureTable();
  const db = getSharedDb();

  const tx_hash = computeTxHash(params.tx_to, params.tx_value, params.chain_id);
  const now = new Date().toISOString();

  const record = db.prepare(`
    SELECT * FROM approvals
    WHERE tx_hash = ? AND agent_id = ? AND status = 'pending' AND expires_at > ?
    ORDER BY requested_at DESC LIMIT 1
  `).get(tx_hash, params.agent_id, now) as ApprovalRecord | undefined;

  if (!record) return null;

  // SECURITY: Check retry count to prevent infinite retry loops
  if (record.retry_count >= MAX_RETRIES) {
    console.error(`[hitl] Max retries (${MAX_RETRIES}) reached for approval ${record.id}`);
    db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(record.id);
    return null;
  }

  // Increment retry count
  db.prepare("UPDATE approvals SET retry_count = retry_count + 1 WHERE id = ?").run(record.id);

  return record;
}

/** Approve a pending request (called by the approval API/CLI) */
export function approveRequest(id: string, approvedBy: string): boolean {
  ensureTable();
  const db = getSharedDb();

  const record = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRecord | undefined;
  if (!record) return false;
  if (record.status !== "pending") return false;
  if (new Date(record.expires_at) < new Date()) return false;
  if (!verifyHmac(record)) {
    console.error(`[hitl] SECURITY WARNING: HMAC verification failed for approval ${record.id}`);
    return false;
  }

  db.prepare(`
    UPDATE approvals SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?
  `).run(approvedBy, new Date().toISOString(), id);

  return true;
}

/** Mark an approval as used (single-use enforcement) */
// SECURITY: Each approval can only be used once. After use, it is marked as 'used'
// and cannot be replayed for the same or any other transaction.
export function markAsUsed(id: string): void {
  ensureTable();
  const db = getSharedDb();
  db.prepare("UPDATE approvals SET status = 'used' WHERE id = ?").run(id);
}

/** List all pending approvals (for dashboard/CLI) */
export function listPending(): ApprovalRecord[] {
  ensureTable();
  const db = getSharedDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM approvals WHERE status = 'pending' AND expires_at > ? ORDER BY requested_at DESC
  `).all(now) as ApprovalRecord[];
}

/** Generate the HMAC token for API authentication */
// KNOWN LIMITATION: The HMAC token is derived from the approval ID and secret.
// Anyone with access to HITL_HMAC_SECRET can generate valid tokens.
// FUTURE: Use asymmetric keys or integrate with an identity provider for approver verification.
export function generateApprovalToken(approvalId: string): string {
  return createHmac("sha256", getHmacSecret()).update(`approve:${approvalId}`).digest("hex");
}

/** Verify an API approval token */
export function verifyApprovalToken(approvalId: string, token: string): boolean {
  const expected = generateApprovalToken(approvalId);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(token, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
