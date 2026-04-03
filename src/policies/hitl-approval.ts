import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";
import {
  consumeValidApproval,
  findPendingApproval,
  createApproval,
} from "../approval.js";

/**
 * Human-in-the-Loop Approval Policy (Pattern 1: Polling)
 *
 * For high-value transactions by non-high-reputation agents, requires explicit
 * human approval before allowing the transaction to proceed.
 *
 * Flow:
 *   1st request → no approval exists → DENY with PENDING_APPROVAL
 *   Human approves via CLI/API
 *   2nd request → approval found → ALLOW (mark as used)
 *
 * SECURITY: See security concerns documented in README.md and plan.md.
 *
 * KNOWN LIMITATION: This pattern returns "deny" for the first request, not "pending".
 * OWS does not support a native "pending" state. The agent must retry after human approval.
 * This means the agent's retry logic determines the UX — OWS has no callback mechanism.
 *
 * KNOWN LIMITATION: Approver identity is not cryptographically verified.
 * The approved_by field is self-reported by whoever calls the approval API.
 * FUTURE: Integrate with an identity provider or require cryptographic signatures.
 *
 * KNOWN LIMITATION: Single approver only. No multi-party (M-of-N) approval support.
 * FUTURE: Add threshold approval logic for high-risk transactions.
 */

// Two thresholds: standard requires approval for mid-rep agents, critical requires approval for ALL agents
const HITL_VALUE_THRESHOLD = BigInt(
  process.env["HITL_VALUE_THRESHOLD"] ?? "1000000000000000000", // 1 ETH
);
const HITL_CRITICAL_THRESHOLD = BigInt(
  process.env["HITL_CRITICAL_THRESHOLD"] ?? "5000000000000000000", // 5 ETH
);
const HIGH_REPUTATION_THRESHOLD = 80;

export const hitlApproval: Policy = {
  name: "hitl-approval",

  async evaluate(ctx: PolicyContext, chainResults: ChainResults): Promise<PolicyResult> {
    const txValue = BigInt(ctx.transaction.value || "0");

    // Low-value transactions never need human approval
    if (txValue <= HITL_VALUE_THRESHOLD) {
      return { allow: true };
    }

    const erc8004Result = chainResults["erc8004-agent"];
    const reputation = (erc8004Result?.metadata?.["reputation"] as number) ?? 0;

    // Critical-value transactions (>5 ETH) always require approval, regardless of reputation
    const isCritical = txValue > HITL_CRITICAL_THRESHOLD;

    // High-reputation agents skip approval for standard high-value (1-5 ETH)
    if (reputation >= HIGH_REPUTATION_THRESHOLD && !isCritical) {
      return { allow: true };
    }

    // High-value + non-high-reputation → check for approval
    const approvalParams = {
      agent_id: ctx.api_key_id,
      wallet_id: ctx.wallet_id,
      chain_id: ctx.chain_id,
      tx_to: ctx.transaction.to,
      tx_value: ctx.transaction.value,
    };

    // Check for existing valid (approved) approval
    const validApproval = consumeValidApproval(approvalParams);
    if (validApproval) {
      return {
        allow: true,
        reason: `Approved by ${validApproval.approved_by ?? "unknown"} (approval: ${validApproval.id})`,
      };
    }

    // Check for existing pending approval (avoid duplicates)
    const pending = findPendingApproval(approvalParams);
    if (pending) {
      return {
        allow: false,
        reason: `PENDING_APPROVAL:${pending.id} — Waiting for human approval. Retry after approval.`,
      };
    }

    // No approval exists → create a new pending request
    const newApproval = createApproval(approvalParams);

    return {
      allow: false,
      reason: `PENDING_APPROVAL:${newApproval.id} — High-value transaction (${txValue} wei) requires human approval. Approve via approval server by operator.`,
    };
  },
};
