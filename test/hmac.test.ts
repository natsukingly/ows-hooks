import { describe, it, expect, beforeEach } from "vitest";
import {
  createApproval,
  approveRequest,
  consumeValidApproval,
  verifyHmac,
  resetApprovalState,
} from "../src/approval.js";
import { getSharedDb } from "../src/db.js";

process.env["OWS_PP_AUDIT_DB"] = ":memory:";
process.env["HITL_HMAC_SECRET"] = "test-hmac-secret";

describe("HMAC integrity", () => {
  beforeEach(() => {
    resetApprovalState();
    // Clear data without dropping table (triggers prevent DELETE, so drop triggers first)
    const db = getSharedDb();
    try {
      db.exec("DROP TRIGGER IF EXISTS no_delete_approvals");
      db.exec("DELETE FROM approvals");
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS no_delete_approvals
        BEFORE DELETE ON approvals
        BEGIN
          SELECT RAISE(ABORT, 'approvals table: DELETE is prohibited');
        END;
      `);
    } catch { /* table may not exist yet */ }
    resetApprovalState();
  });

  it("valid record passes HMAC verification", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    expect(verifyHmac(record)).toBe(true);
  });

  it("tampered tx_to fails HMAC verification", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    // Tamper with the record
    const tampered = { ...record, tx_to: "0xEVIL" };
    expect(verifyHmac(tampered)).toBe(false);
  });

  it("tampered tx_value fails HMAC verification", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    const tampered = { ...record, tx_value: "9999999" };
    expect(verifyHmac(tampered)).toBe(false);
  });

  it("tampered agent_id fails HMAC verification", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    const tampered = { ...record, agent_id: "evil-agent" };
    expect(verifyHmac(tampered)).toBe(false);
  });

  it("approveRequest rejects tampered DB record", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    // Tamper directly in DB
    const db = getSharedDb();
    db.prepare("UPDATE approvals SET tx_to = '0xEVIL' WHERE id = ?").run(record.id);

    // approveRequest should reject due to HMAC mismatch
    const result = approveRequest(record.id, "alice");
    expect(result).toBe(false);
  });

  it("consumeValidApproval rejects tampered DB record", () => {
    const record = createApproval({
      agent_id: "agent-1",
      wallet_id: "wallet-1",
      chain_id: "eip155:1",
      tx_to: "0xabc",
      tx_value: "1000",
    });

    // Approve it first
    approveRequest(record.id, "alice");

    // Tamper with tx_value in DB
    const db = getSharedDb();
    db.prepare("UPDATE approvals SET tx_value = '9999999' WHERE id = ?").run(record.id);

    // consumeValidApproval should reject
    const consumed = consumeValidApproval({
      agent_id: "agent-1",
      tx_to: "0xabc",
      tx_value: "1000",
      chain_id: "eip155:1",
    });
    expect(consumed).toBeNull();
  });
});
