import type { OnDenyHook, PolicyContext, PolicyResult } from "../types.js";

/**
 * On-deny hooks — fire when a signing request is DENIED.
 * These are non-blocking: the deny result has already been returned to OWS.
 *
 * Use cases:
 * - Alert security team
 * - Log incident details
 * - Suspend agent after repeated denials
 * - Suggest conditional retry (e.g., "retry after KYC completion")
 */

/** Alert via webhook when a signing request is denied */
const alertOnDeny: OnDenyHook = async (ctx, result) => {
  const endpoint = process.env["ON_DENY_WEBHOOK_URL"];
  if (!endpoint) return;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "signing_denied",
        severity: "warning",
        agent_id: ctx.api_key_id,
        wallet_id: ctx.wallet_id,
        chain_id: ctx.chain_id,
        to: ctx.transaction.to,
        value: ctx.transaction.value,
        reason: result.reason,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.error("[on-deny] alert webhook failed");
  }
};

/** Slack alert for denied transactions */
const slackAlertOnDeny: OnDenyHook = async (ctx, result) => {
  const slackUrl = process.env["SLACK_WEBHOOK_URL"];
  if (!slackUrl) return;

  try {
    await fetch(slackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚫 Signing DENIED: agent=${ctx.api_key_id} to=${ctx.transaction.to} reason="${result.reason}"`,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.error("[on-deny] slack alert failed");
  }
};

/**
 * Suggest conditional retry based on denial reason.
 * Outputs to stderr as guidance for the calling agent.
 */
const conditionalRetryGuidance: OnDenyHook = async (ctx, result) => {
  const reason = result.reason ?? "";

  if (reason.includes("KYC")) {
    console.error(
      `[on-deny] RETRY HINT: Complete KYC for ${ctx.transaction.to} before retrying`,
    );
  } else if (reason.includes("reputation")) {
    console.error(
      `[on-deny] RETRY HINT: Agent ${ctx.api_key_id} needs higher ERC-8004 reputation. Current transaction requires reputation ≥ 80`,
    );
  } else if (reason.includes("sanctions")) {
    console.error(
      `[on-deny] NO RETRY: ${ctx.transaction.to} is on the sanctions list. This transaction cannot be approved.`,
    );
  }
};

/** Print on-deny summary to stderr */
const demoLog: OnDenyHook = async (ctx, result) => {
  console.error(
    `[on-deny] 🚫 Denied: agent=${ctx.api_key_id} reason="${result.reason}"`,
  );
};

export const onDenyHooks: OnDenyHook[] = [
  demoLog,
  conditionalRetryGuidance,
  alertOnDeny,
  slackAlertOnDeny,
];
