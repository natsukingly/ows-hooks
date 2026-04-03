import { describe, it, expect, beforeEach } from "vitest";
import { hitlApproval } from "../src/policies/hitl-approval.js";
import {
  createApproval,
  approveRequest,
  findValidApproval,
  computeTxHash,
  verifyApprovalToken,
  generateApprovalToken,
  markAsUsed,
  listPending,
  resetApprovalState,
} from "../src/approval.js";
import type { PolicyContext, ChainResults } from "../src/types.js";
import { getSharedDb } from "../src/db.js";

process.env["ERC8004_MOCK"] = "true";
process.env["HITL_HMAC_SECRET"] = "test-secret";
process.env["HITL_APPROVAL_TTL_MINUTES"] = "15";

function makeCtx(overrides: {
  api_key_id?: string;
  transaction?: Partial<PolicyContext["transaction"]>;
} = {}): PolicyContext {
  const defaultTx = {
    to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    value: "100000000000000000", // 0.1 ETH
    raw_hex: "0x00",
    data: "0x",
  };
  return {
    chain_id: "eip155:1",
    wallet_id: "test-wallet",
    api_key_id: overrides.api_key_id ?? "trusted-agent",
    transaction: { ...defaultTx, ...overrides.transaction },
    spending: { daily_total: "0", date: "2026-04-03" },
    timestamp: "2026-04-03T10:00:00Z",
  };
}

function clearApprovals(): void {
  const db = getSharedDb();
  db.exec("DROP TABLE IF EXISTS approvals");
  resetApprovalState();
}

describe("Approval CRUD", () => {
  beforeEach(() => clearApprovals());

  it("creates a pending approval", () => {
    const approval = createApproval({
      agent_id: "test-agent",
      wallet_id: "test-wallet",
      chain_id: "eip155:1",
      tx_to: "0xABC",
      tx_value: "2000000000000000000",
    });

    expect(approval.status).toBe("pending");
    expect(approval.tx_hash).toBe(computeTxHash("0xABC", "2000000000000000000", "eip155:1"));
    expect(approval.hmac).toBeTruthy();
  });

  it("approves a pending request", () => {
    const approval = createApproval({
      agent_id: "test-agent",
      wallet_id: "test-wallet",
      chain_id: "eip155:1",
      tx_to: "0xABC",
      tx_value: "2000000000000000000",
    });

    const success = approveRequest(approval.id, "alice");
    expect(success).toBe(true);

    const valid = findValidApproval({
      agent_id: "test-agent",
      tx_to: "0xABC",
      tx_value: "2000000000000000000",
      chain_id: "eip155:1",
    });
    expect(valid).not.toBeNull();
    expect(valid!.approved_by).toBe("alice");
  });

  it("rejects approval of non-existent request", () => {
    const success = approveRequest("non-existent-id", "alice");
    expect(success).toBe(false);
  });

  it("marks approval as used (single-use)", () => {
    const approval = createApproval({
      agent_id: "test-agent",
      wallet_id: "test-wallet",
      chain_id: "eip155:1",
      tx_to: "0xABC",
      tx_value: "2000000000000000000",
    });

    approveRequest(approval.id, "alice");
    markAsUsed(approval.id);

    // After marking as used, findValidApproval should return null
    const valid = findValidApproval({
      agent_id: "test-agent",
      tx_to: "0xABC",
      tx_value: "2000000000000000000",
      chain_id: "eip155:1",
    });
    expect(valid).toBeNull();
  });

  it("lists pending approvals", () => {
    createApproval({
      agent_id: "agent-1",
      wallet_id: "w",
      chain_id: "eip155:1",
      tx_to: "0xA",
      tx_value: "1",
    });
    createApproval({
      agent_id: "agent-2",
      wallet_id: "w",
      chain_id: "eip155:1",
      tx_to: "0xB",
      tx_value: "2",
    });

    const pending = listPending();
    expect(pending.length).toBe(2);
  });
});

describe("HMAC Token", () => {
  it("generates and verifies approval token", () => {
    const token = generateApprovalToken("test-id");
    expect(verifyApprovalToken("test-id", token)).toBe(true);
  });

  it("rejects invalid token", () => {
    expect(verifyApprovalToken("test-id", "invalid-token")).toBe(false);
  });

  it("different IDs produce different tokens", () => {
    const token1 = generateApprovalToken("id-1");
    const token2 = generateApprovalToken("id-2");
    expect(token1).not.toBe(token2);
  });
});

describe("HITL Policy", () => {
  beforeEach(() => clearApprovals());

  it("allows low-value transactions without approval", async () => {
    const ctx = makeCtx({
      api_key_id: "mid-level-agent",
      transaction: { value: "100000000000000000" }, // 0.1 ETH
    });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };

    const result = await hitlApproval.evaluate(ctx, chainResults);
    expect(result.allow).toBe(true);
  });

  it("allows high-reputation agents without approval", async () => {
    const ctx = makeCtx({
      api_key_id: "trusted-agent",
      transaction: { value: "5000000000000000000" }, // 5 ETH
    });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 90 } },
    };

    const result = await hitlApproval.evaluate(ctx, chainResults);
    expect(result.allow).toBe(true);
  });

  it("denies high-value + mid-reputation without approval", async () => {
    const ctx = makeCtx({
      api_key_id: "mid-level-agent",
      transaction: { value: "2000000000000000000" }, // 2 ETH
    });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };

    const result = await hitlApproval.evaluate(ctx, chainResults);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("PENDING_APPROVAL");
  });

  it("allows after human approval (full flow)", async () => {
    const ctx = makeCtx({
      api_key_id: "mid-level-agent",
      transaction: { value: "2000000000000000000" },
    });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };

    // 1st request → deny
    const firstResult = await hitlApproval.evaluate(ctx, chainResults);
    expect(firstResult.allow).toBe(false);

    // Extract approval ID from reason
    const match = firstResult.reason!.match(/PENDING_APPROVAL:([a-f0-9-]+):/);
    const approvalId = match![1];

    // Human approves
    const approved = approveRequest(approvalId, "alice");
    expect(approved).toBe(true);

    // 2nd request → allow
    const secondResult = await hitlApproval.evaluate(ctx, chainResults);
    expect(secondResult.allow).toBe(true);
    expect(secondResult.reason).toContain("alice");
  });

  it("blocks replay after approval is used", async () => {
    const ctx = makeCtx({
      api_key_id: "mid-level-agent",
      transaction: { value: "2000000000000000000" },
    });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };

    // 1st request → deny
    const firstResult = await hitlApproval.evaluate(ctx, chainResults);
    const match = firstResult.reason!.match(/PENDING_APPROVAL:([a-f0-9-]+):/);
    const approvalId = match![1];

    // Human approves
    approveRequest(approvalId, "alice");

    // 2nd request → allow (uses the approval)
    const secondResult = await hitlApproval.evaluate(ctx, chainResults);
    expect(secondResult.allow).toBe(true);

    // 3rd request → deny again (approval was used, single-use)
    const thirdResult = await hitlApproval.evaluate(ctx, chainResults);
    expect(thirdResult.allow).toBe(false);
    expect(thirdResult.reason).toContain("PENDING_APPROVAL");
  });
});
