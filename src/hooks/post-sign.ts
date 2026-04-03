import type { PostSignHook, PolicyContext, PolicyResult } from "../types.js";
import { getAuditLog } from "../audit.js";

/**
 * Post-sign hooks — fire after a signing request is APPROVED.
 * These are non-blocking: OWS has already signed by the time these run.
 *
 * Use cases:
 * - Record signing event to external systems
 * - Notify stakeholders
 * - Update analytics / dashboards
 * - Write Merkle Root to chain (batch)
 */

/** Log the approved signing to an external system (e.g., Datadog, Splunk) */
const externalAuditLog: PostSignHook = async (ctx, result) => {
  const endpoint = process.env["POST_SIGN_WEBHOOK_URL"];
  if (!endpoint) return;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "signing_approved",
        agent_id: ctx.api_key_id,
        wallet_id: ctx.wallet_id,
        chain_id: ctx.chain_id,
        to: ctx.transaction.to,
        value: ctx.transaction.value,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Post-sign hooks are non-blocking — failures are logged but never block signing
    console.error("[post-sign] external audit log failed");
  }
};

/** Notify via Slack when high-value transactions are approved */
const slackNotification: PostSignHook = async (ctx, _result) => {
  const slackUrl = process.env["SLACK_WEBHOOK_URL"];
  if (!slackUrl) return;

  const valueEth = Number(BigInt(ctx.transaction.value || "0")) / 1e18;
  if (valueEth < 1) return; // Only notify for high-value tx

  try {
    await fetch(slackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `✅ High-value signing approved: ${valueEth.toFixed(4)} ETH → ${ctx.transaction.to} (agent: ${ctx.api_key_id})`,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.error("[post-sign] slack notification failed");
  }
};

/** Print post-sign summary to stderr (visible in demo, doesn't affect stdout) */
const demoLog: PostSignHook = async (ctx, _result) => {
  console.error(
    `[post-sign] ✅ Signed: agent=${ctx.api_key_id} to=${ctx.transaction.to} value=${ctx.transaction.value}`,
  );
};

export const postSignHookRegistry = new Map<string, PostSignHook>([
  ["stderr-log", demoLog],
  ["external-audit", externalAuditLog],
  ["slack-notify", slackNotification],
]);

export const postSignHooks: PostSignHook[] = [...postSignHookRegistry.values()];
