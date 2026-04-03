import type { Policy, PostSignHook, OnDenyHook } from "./types.js";

import { txSafety } from "./policies/tx-safety.js";
import { kycCheck } from "./policies/kyc-check.js";
import { amlCheck } from "./policies/aml-check.js";
import { erc8004Agent } from "./policies/erc8004-agent.js";
import { policyChain } from "./policies/policy-chain.js";
import { hitlApproval } from "./policies/hitl-approval.js";
import { x402Trust } from "./policies/x402-trust.js";
import { postSignHookRegistry } from "./hooks/post-sign.js";
import { onDenyHookRegistry } from "./hooks/on-deny.js";

// ── Policy Registry ──

export const policyRegistry = new Map<string, Policy>([
  ["tx-safety", txSafety],
  ["kyc-check", kycCheck],
  ["aml-check", amlCheck],
  ["erc8004-agent", erc8004Agent],
  ["policy-chain", policyChain],
  ["hitl-approval", hitlApproval],
  ["x402-trust", x402Trust],
]);

/** Default policy order when no config file is present */
export const defaultPolicyOrder: readonly string[] = [
  "tx-safety",
  "aml-check",
  "erc8004-agent",
  "policy-chain",
  "hitl-approval",
  "x402-trust",
];

/** Default hooks when no config file is present (explicitly listed, not auto-spread from registry) */
export const defaultPostSignHooks: readonly string[] = [
  "stderr-log",
  "external-audit",
  "slack-notify",
];
export const defaultOnDenyHooks: readonly string[] = [
  "stderr-log",
  "retry-guidance",
  "alert-webhook",
  "slack-alert",
];

// Re-export hook registries for config resolver
export { postSignHookRegistry, onDenyHookRegistry };
export type { PostSignHook, OnDenyHook };
