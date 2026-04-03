import { describe, it, expect } from "vitest";
import { txSafety } from "../src/policies/tx-safety.js";
import { amlCheck } from "../src/policies/aml-check.js";
import { erc8004Agent } from "../src/policies/erc8004-agent.js";
import { policyChain } from "../src/policies/policy-chain.js";
import { x402Trust } from "../src/policies/x402-trust.js";
import { evaluatePolicies } from "../src/evaluate.js";
import type { PolicyContext, ChainResults } from "../src/types.js";

process.env["ERC8004_MOCK"] = "true";

function makeCtx(overrides: {
  api_key_id?: string;
  transaction?: Partial<PolicyContext["transaction"]>;
} = {}): PolicyContext {
  const defaultTx = {
    to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    value: "100000000000000000",
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

describe("Transaction Safety", () => {
  it("allows trusted address from address book", async () => {
    const result = await txSafety.evaluate(makeCtx(), {});
    expect(result.allow).toBe(true);
  });

  it("blocks high-risk address", async () => {
    const ctx = makeCtx({
      transaction: { to: "0x9999999999999999999999999999999999999999" },
    });
    const result = await txSafety.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("high-risk");
  });

  it("detects address poisoning", async () => {
    // 0x742d...bD00 is similar to trusted 0x742d...bD0C (distance=2)
    const ctx = makeCtx({
      transaction: { to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD00" },
    });
    const result = await txSafety.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("poisoning");
  });

  it("allows unknown address with caution", async () => {
    const ctx = makeCtx({
      transaction: { to: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" },
    });
    const result = await txSafety.evaluate(ctx, {});
    expect(result.allow).toBe(true); // unknown but not blocked
  });
});

describe("AML Check", () => {
  it("allows clean address", async () => {
    const result = await amlCheck.evaluate(makeCtx(), {});
    expect(result.allow).toBe(true);
  });

  it("blocks sanctioned address", async () => {
    const ctx = makeCtx({
      transaction: { to: "0xDEAD000000000000000000000000000000000000" },
    });
    const result = await amlCheck.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("sanctions");
  });
});

describe("ERC-8004 Agent ID", () => {
  it("allows high-reputation agent", async () => {
    const ctx = makeCtx({ api_key_id: "trusted-agent" });
    const result = await erc8004Agent.evaluate(ctx, {});
    expect(result.allow).toBe(true);
  });

  it("blocks low-reputation agent", async () => {
    const ctx = makeCtx({ api_key_id: "new-agent" });
    const result = await erc8004Agent.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("reputation");
  });

  it("blocks unregistered agent", async () => {
    const ctx = makeCtx({ api_key_id: "unknown-agent" });
    const result = await erc8004Agent.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("not registered");
  });
});

describe("Policy Chaining", () => {
  it("allows high reputation + high value", async () => {
    const ctx = makeCtx({ transaction: { value: "2000000000000000000" } });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 90 } },
    };
    const result = await policyChain.evaluate(ctx, chainResults);
    expect(result.allow).toBe(true);
  });

  it("blocks mid reputation + high value", async () => {
    const ctx = makeCtx({ transaction: { value: "2000000000000000000" } });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };
    const result = await policyChain.evaluate(ctx, chainResults);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("reputation");
  });

  it("allows mid reputation + low value", async () => {
    const ctx = makeCtx({ transaction: { value: "100000000000000000" } });
    const chainResults: ChainResults = {
      "erc8004-agent": { allow: true, metadata: { reputation: 60 } },
    };
    const result = await policyChain.evaluate(ctx, chainResults);
    expect(result.allow).toBe(true);
  });

  it("blocks when upstream result missing", async () => {
    const ctx = makeCtx();
    const result = await policyChain.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("not found");
  });
});

describe("x402 Trust Score", () => {
  it("allows trusted x402 service", async () => {
    const ctx = makeCtx({
      transaction: { to: "0x7d9d1821d15B9e0b8Ab98A058361233E255E405D" },
    });
    const result = await x402Trust.evaluate(ctx, {});
    expect(result.allow).toBe(true);
  });

  it("blocks low trust score service", async () => {
    const ctx = makeCtx({
      transaction: { to: "0x2222222222222222222222222222222222222222" },
    });
    const result = await x402Trust.evaluate(ctx, {});
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("trust score");
  });

  it("skips unknown address (not an x402 service)", async () => {
    const ctx = makeCtx({
      transaction: { to: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    });
    const result = await x402Trust.evaluate(ctx, {});
    expect(result.allow).toBe(true); // not in registry = not x402, skip
  });
});

describe("Full Pipeline (transfer)", () => {
  it("allows all-clear transfer", async () => {
    const ctx = makeCtx({ api_key_id: "trusted-agent" });
    const result = await evaluatePolicies(
      [txSafety, amlCheck, erc8004Agent, policyChain],
      ctx,
    );
    expect(result.allow).toBe(true);
  });

  it("blocks address poisoning at tx-safety", async () => {
    const ctx = makeCtx({
      api_key_id: "trusted-agent",
      transaction: { to: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD00" },
    });
    const result = await evaluatePolicies(
      [txSafety, amlCheck, erc8004Agent, policyChain],
      ctx,
    );
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("poisoning");
  });
});

describe("Full Pipeline (x402 payment)", () => {
  it("allows payment to trusted x402 service", async () => {
    const ctx = makeCtx({
      api_key_id: "trusted-agent",
      transaction: { to: "0x7d9d1821d15B9e0b8Ab98A058361233E255E405D", value: "10000" },
    });
    const result = await evaluatePolicies(
      [txSafety, amlCheck, erc8004Agent, policyChain, x402Trust],
      ctx,
    );
    expect(result.allow).toBe(true);
  });

  it("blocks payment to untrusted x402 service", async () => {
    // 0x3333... has risk score 0 (passes tx-safety) but trust score 0 (fails x402-trust)
    const ctx = makeCtx({
      api_key_id: "trusted-agent",
      transaction: { to: "0x3333333333333333333333333333333333333333", value: "10000" },
    });
    const result = await evaluatePolicies(
      [txSafety, amlCheck, erc8004Agent, policyChain, x402Trust],
      ctx,
    );
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("trust score");
  });
});
