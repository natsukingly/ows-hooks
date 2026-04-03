import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { rmSync } from "node:fs";
import { closeDb } from "../src/db.js";
import { createApproval, resetApprovalState } from "../src/approval.js";
import { recordAudit, getAuditLog, closeAudit } from "../src/audit.js";
import type { AuditEntry } from "../src/types.js";

process.env["HITL_HMAC_SECRET"] = "test-db-switch-secret";
const originalDbPath = process.env["OWS_PP_AUDIT_DB"];

function makeDbPath(name: string): string {
  return path.join("/tmp", `ows-hooks-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

function makeAuditEntry(policyName: string): AuditEntry {
  return {
    timestamp: "2026-04-04T00:00:00Z",
    agent_id: "agent",
    wallet_id: "wallet",
    chain_id: "eip155:1",
    tx_to: "0x1111111111111111111111111111111111111111",
    tx_value: "1",
    policy_name: policyName,
    result: "allow",
    reason: null,
    context_hash: "ctx",
  };
}

describe("DB path switching", () => {
  let db1 = "";
  let db2 = "";

  beforeEach(() => {
    db1 = makeDbPath("db1");
    db2 = makeDbPath("db2");
    closeAudit();
    resetApprovalState();
    process.env["OWS_PP_AUDIT_DB"] = db1;
  });

  afterEach(() => {
    closeAudit();
    resetApprovalState();
    closeDb();
    if (originalDbPath === undefined) {
      delete process.env["OWS_PP_AUDIT_DB"];
    } else {
      process.env["OWS_PP_AUDIT_DB"] = originalDbPath;
    }
    rmSync(db1, { force: true });
    rmSync(db2, { force: true });
  });

  it("recreates approvals table after DB path change", () => {
    expect(() =>
      createApproval({
        agent_id: "agent-1",
        wallet_id: "wallet-1",
        chain_id: "eip155:1",
        tx_to: "0xabc",
        tx_value: "100",
      }),
    ).not.toThrow();

    process.env["OWS_PP_AUDIT_DB"] = db2;

    expect(() =>
      createApproval({
        agent_id: "agent-2",
        wallet_id: "wallet-2",
        chain_id: "eip155:1",
        tx_to: "0xdef",
        tx_value: "200",
      }),
    ).not.toThrow();
  });

  it("rebuilds cached audit insert statement after DB path change", () => {
    recordAudit(makeAuditEntry("policy-db1"));
    process.env["OWS_PP_AUDIT_DB"] = db2;

    expect(() => recordAudit(makeAuditEntry("policy-db2"))).not.toThrow();
    const log = getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0].policy_name).toBe("policy-db2");
  });
});

