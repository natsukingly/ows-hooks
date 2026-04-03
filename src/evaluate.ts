import type { Policy, PolicyContext, PolicyResult, ChainResults } from "./types.js";
import { recordAudit } from "./audit.js";
import { createHash } from "node:crypto";

const POLICY_TIMEOUT_MS = Number(process.env["POLICY_TIMEOUT_MS"] ?? "5000");

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, policyName: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Policy "${policyName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

/**
 * Evaluates policies sequentially.
 * - Any single deny → short-circuit the entire evaluation to deny immediately
 * - ChainResults propagates the result of the preceding policy to the next
 * - Any error/exception → deny-by-default
 */
export async function evaluatePolicies(
  policies: Policy[],
  ctx: PolicyContext,
): Promise<PolicyResult> {
  const chainResults: ChainResults = {};
  const contextHash = createHash("sha256")
    .update(JSON.stringify(ctx))
    .digest("hex");

  for (const policy of policies) {
    let result: PolicyResult;

    try {
      result = await withTimeout(policy.evaluate(ctx, chainResults), POLICY_TIMEOUT_MS, policy.name);
    } catch (err) {
      result = {
        allow: false,
        reason: `Policy "${policy.name}" threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Record to audit log
    recordAudit({
      timestamp: new Date().toISOString(),
      agent_id: ctx.api_key_id,
      wallet_id: ctx.wallet_id,
      chain_id: ctx.chain_id,
      tx_to: ctx.transaction.to,
      tx_value: ctx.transaction.value,
      policy_name: policy.name,
      result: result.allow ? "allow" : "deny",
      reason: result.reason ?? null,
      context_hash: contextHash,
    });

    // Accumulate into ChainResults (accessible by downstream policies)
    chainResults[policy.name] = result;

    // short-circuit: terminate immediately if denied
    if (!result.allow) {
      return result;
    }
  }

  return { allow: true };
}
