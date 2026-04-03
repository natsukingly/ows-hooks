import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

/**
 * Policy Chaining: dynamically modifies rules based on the result of the preceding policy.
 *
 * Logic:
 * - ERC-8004 reputation is high (≥80) → no additional checks (trusted)
 * - Reputation is moderate (50-79) → deny only for high-value transfers (>1 ETH)
 * - Reputation is low (<50) → deny all transfers (should already be blocked upstream, but acts as a safety net)
 *
 * This is impossible with built-in static rules.
 * Dynamic dependencies between policies are the core of Programmable Policy.
 */

const HIGH_REPUTATION_THRESHOLD = 80;
const HIGH_VALUE_THRESHOLD = BigInt("1000000000000000000"); // 1 ETH in wei

export const policyChain: Policy = {
  name: "policy-chain",

  async evaluate(ctx: PolicyContext, chainResults: ChainResults): Promise<PolicyResult> {
    // Retrieve the ERC-8004 result from the preceding policy
    const erc8004Result = chainResults["erc8004-agent"];

    if (!erc8004Result) {
      // ERC-8004 policy has not been executed (misconfiguration, etc.) → deny
      return {
        allow: false,
        reason: "Policy chain error: erc8004-agent result not found",
      };
    }

    // Should not reach here if denied by ERC-8004 (short-circuit)
    // Check anyway for safety
    if (!erc8004Result.allow) {
      return {
        allow: false,
        reason: "Agent was denied by ERC-8004 policy",
      };
    }

    const reputation = (erc8004Result.metadata?.["reputation"] as number) ?? 0;
    const txValue = BigInt(ctx.transaction.value || "0");

    // High reputation → allow unconditionally
    if (reputation >= HIGH_REPUTATION_THRESHOLD) {
      return { allow: true };
    }

    // Moderate reputation + high-value transfer → deny
    if (txValue > HIGH_VALUE_THRESHOLD) {
      return {
        allow: false,
        reason: `Agent reputation (${reputation}) too low for high-value transaction (${txValue} wei). Minimum reputation: ${HIGH_REPUTATION_THRESHOLD}`,
      };
    }

    // Moderate reputation + low-value transfer → allow
    return { allow: true };
  },
};
