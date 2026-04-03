import { evaluatePolicies } from "./evaluate.js";
import { closeAudit } from "./audit.js";
import { loadConfig, resolveConfig } from "./config.js";
import type { PolicyContext, PolicyResult, PostSignHook, OnDenyHook } from "./types.js";

// Load config from ows-hooks.json (falls back to defaults if file is absent)
const config = loadConfig();
const { policies, postSignHooks, onDenyHooks } = resolveConfig(config);

async function main(): Promise<void> {
  // Read PolicyContext from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const input = Buffer.concat(chunks).toString("utf-8").trim();
  if (!input) {
    writeResult({ allow: false, reason: "Empty input" });
    return;
  }

  let ctx: PolicyContext;
  try {
    ctx = JSON.parse(input) as PolicyContext;
  } catch {
    writeResult({ allow: false, reason: "Invalid JSON input" });
    return;
  }

  // Validate required fields
  if (!ctx.transaction?.to || !ctx.chain_id || !ctx.wallet_id) {
    writeResult({ allow: false, reason: "Missing required fields in PolicyContext" });
    return;
  }

  try {
    // ── pre-sign: policy evaluation ──
    const result = await evaluatePolicies([...policies], ctx);

    // Return result to OWS immediately (stdout)
    writeResult(result);

    // ── post-sign / on-deny hooks (non-blocking, fire after result) ──
    if (result.allow) {
      await runHooks(postSignHooks, ctx, result);
    } else {
      await runHooks(onDenyHooks, ctx, result);
    }
  } catch {
    writeResult({ allow: false, reason: "Internal policy evaluation error" });
  } finally {
    closeAudit();
  }
}

/** Run hooks sequentially. Failures are caught and logged — never affect the result. */
async function runHooks(
  hooks: readonly (PostSignHook | OnDenyHook)[],
  ctx: PolicyContext,
  result: PolicyResult,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(ctx, result);
    } catch (err) {
      console.error(`[hook error] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function writeResult(result: PolicyResult): void {
  process.stdout.write(JSON.stringify({ allow: result.allow, reason: result.reason }));
}

main();
