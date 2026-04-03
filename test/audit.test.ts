import { describe, it, expect } from "vitest";
import { recordAudit, getAuditLog, closeAudit } from "../src/audit.js";
import { getSharedDb } from "../src/db.js";
import type { AuditEntry } from "../src/types.js";

process.env["OWS_PP_AUDIT_DB"] = ":memory:";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-04-03T10:00:00Z",
    agent_id: "test-agent",
    wallet_id: "test-wallet",
    chain_id: "eip155:1",
    tx_to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    tx_value: "100000000000000000",
    policy_name: "audit-test-policy",
    result: "allow",
    reason: null,
    context_hash: "abc123",
    ...overrides,
  };
}

describe("audit", () => {
  it("records and retrieves audit entries", () => {
    const before = getAuditLog().length;

    recordAudit(makeEntry());
    recordAudit(makeEntry({ policy_name: "audit-test-deny", result: "deny", reason: "sanctions" }));

    const log = getAuditLog();
    expect(log.length - before).toBe(2);

    const newEntries = log.slice(before);
    expect(newEntries[0].policy_name).toBe("audit-test-policy");
    expect(newEntries[1].result).toBe("deny");
  });

  it("append-only: DELETE is prohibited", () => {
    recordAudit(makeEntry());
    const db = getSharedDb();
    expect(() => db.exec("DELETE FROM audit_log")).toThrow("append-only");
  });

  it("append-only: UPDATE is prohibited", () => {
    recordAudit(makeEntry());
    const db = getSharedDb();
    expect(() => db.exec("UPDATE audit_log SET result = 'deny'")).toThrow("append-only");
  });
});
