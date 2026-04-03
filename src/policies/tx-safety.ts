import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Data files ──
interface AddressBookEntry {
  label: string;
  added_at: string;
}
interface AddressBook {
  trusted_addresses: Record<string, AddressBookEntry>;
}

interface RiskScore {
  risk: number;
  label: string;
}
interface RiskData {
  scores: Record<string, RiskScore>;
  max_risk_score: number;
}

const addressBook: AddressBook = JSON.parse(
  readFileSync(path.join(__dirname, "../../data/address-book.json"), "utf-8"),
);

const riskData: RiskData = JSON.parse(
  readFileSync(path.join(__dirname, "../../data/address-risk-scores.json"), "utf-8"),
);

// Normalize for case-insensitive comparison
const trustedSet = new Map(
  Object.entries(addressBook.trusted_addresses).map(([addr, entry]) => [
    addr.toLowerCase(),
    entry,
  ]),
);

const riskMap = new Map(
  Object.entries(riskData.scores).map(([addr, score]) => [
    addr.toLowerCase(),
    score,
  ]),
);

/**
 * Compute Levenshtein distance between two strings.
 * Used for address poisoning detection.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Detect address poisoning: check if the target address is suspiciously similar
 * to a trusted address in the address book.
 * Returns the similar trusted address if poisoning is suspected, null otherwise.
 */
function detectPoisoning(target: string): { similarTo: string; label: string; distance: number } | null {
  const targetLower = target.toLowerCase();

  for (const [trusted, entry] of trustedSet) {
    if (trusted === targetLower) continue; // exact match = not poisoning

    const distance = levenshtein(targetLower, trusted);

    // Addresses are 42 chars. Distance ≤ 4 means very similar (likely poisoning)
    if (distance > 0 && distance <= 4) {
      return { similarTo: trusted, label: entry.label, distance };
    }
  }
  return null;
}

/**
 * Transaction Safety policy.
 * Replaces KYC check with a more meaningful security check:
 *
 * 1. Address book lookup — trusted addresses get fast-tracked
 * 2. Address poisoning detection — similar-looking addresses are blocked
 * 3. Risk score check — high-risk addresses (via GoPlus-style API) are blocked
 *
 * In production, step 3 would call GoPlus x402 API for real-time risk scoring.
 */
export const txSafety: Policy = {
  name: "tx-safety",

  async evaluate(ctx: PolicyContext, _chainResults: ChainResults): Promise<PolicyResult> {
    const to = ctx.transaction.to;
    const toLower = to.toLowerCase();

    // 1. Address book: trusted addresses are fast-tracked
    const trustedEntry = trustedSet.get(toLower);
    if (trustedEntry) {
      return {
        allow: true,
        metadata: { trusted: true, label: trustedEntry.label },
      } as PolicyResult & { metadata?: Record<string, unknown> };
    }

    // 2. Address poisoning detection
    const poisoning = detectPoisoning(to);
    if (poisoning) {
      return {
        allow: false,
        reason: `Address poisoning detected: ${to} is suspiciously similar to trusted address "${poisoning.label}" (${poisoning.similarTo}), distance=${poisoning.distance}. Possible address poisoning attack.`,
      };
    }

    // 3. Risk score check (mock GoPlus API — in production, call GoPlus x402 endpoint)
    const riskScore = riskMap.get(toLower);

    if (!riskScore) {
      // Unknown address, not in address book → warn but allow with caution
      return {
        allow: true,
        metadata: { trusted: false, risk: "unknown" },
      } as PolicyResult & { metadata?: Record<string, unknown> };
    }

    if (riskScore.risk > riskData.max_risk_score) {
      return {
        allow: false,
        reason: `Address ${to} flagged as ${riskScore.label} (risk score: ${riskScore.risk}/${riskData.max_risk_score} max). Transaction blocked for safety.`,
      };
    }

    return {
      allow: true,
      metadata: { trusted: false, risk_score: riskScore.risk, risk_label: riskScore.label },
    } as PolicyResult & { metadata?: Record<string, unknown> };
  },
};
