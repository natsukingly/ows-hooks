/**
 * stdin/stdout type definitions for OWS executable policy
 * Compliant with OWS v1.2.0 specification
 */

/** PolicyContext passed by OWS to the executable via stdin */
export interface PolicyContext {
  chain_id: string;
  wallet_id: string;
  api_key_id: string;
  transaction: {
    to: string;
    value: string; // string in wei units
    raw_hex: string;
    data: string;
  };
  spending: {
    daily_total: string; // string in wei units
    date: string;
  };
  timestamp: string; // ISO 8601
}

/** PolicyResult returned to OWS via stdout */
export interface PolicyResult {
  allow: boolean;
  reason?: string;
}

/** Type for policy functions */
export type PolicyFn = (
  ctx: PolicyContext,
  chainResults: ChainResults,
) => Promise<PolicyResult>;

/** Policy Chaining: passes the result of the preceding policy to the next */
export interface ChainResults {
  [policyName: string]: PolicyResult & { metadata?: Record<string, unknown> };
}

/** Policy definition */
export interface Policy {
  name: string;
  evaluate: PolicyFn;
}

// ── Signing Hooks ──

/** Hook that fires after a successful signing (non-blocking) */
export type PostSignHook = (ctx: PolicyContext, result: PolicyResult) => Promise<void>;

/** Hook that fires when a signing request is denied (non-blocking) */
export type OnDenyHook = (ctx: PolicyContext, result: PolicyResult) => Promise<void>;

/** Audit log entry */
export interface AuditEntry {
  timestamp: string;
  agent_id: string;
  wallet_id: string;
  chain_id: string;
  tx_to: string;
  tx_value: string;
  policy_name: string;
  result: "allow" | "deny";
  reason: string | null;
  context_hash: string;
}
