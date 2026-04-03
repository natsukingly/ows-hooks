import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "../../data/x402-trust-scores.json");

interface ServiceInfo {
  name: string;
  trust_score: number;
  verified: boolean;
  category: string;
}

interface TrustData {
  services: Record<string, ServiceInfo>;
  min_trust_score: number;
  require_verified_for_high_value: boolean;
  high_value_threshold: string;
}

const trustData: TrustData = JSON.parse(readFileSync(dataPath, "utf-8"));

/**
 * x402 Endpoint Trust Score policy.
 *
 * Checks the trust score of the x402 service the agent is paying.
 * - Unknown services (not in registry) → deny
 * - Low trust score (< min_trust_score) → deny
 * - Unverified service + high-value payment → deny
 * - Verified + sufficient trust score → allow
 *
 * In production, this would query a live x402 service registry or
 * reputation oracle instead of a local JSON file.
 */
export const x402Trust: Policy = {
  name: "x402-trust",

  async evaluate(ctx: PolicyContext, _chainResults: ChainResults): Promise<PolicyResult> {
    const recipient = ctx.transaction.to.toLowerCase();

    // Look up service by payment address
    const service = Object.entries(trustData.services).find(
      ([addr]) => addr.toLowerCase() === recipient,
    );

    if (!service) {
      // Address not in x402 service registry → not an x402 payment, skip this policy
      return { allow: true };
    }

    const [, info] = service;

    // Check minimum trust score
    if (info.trust_score < trustData.min_trust_score) {
      return {
        allow: false,
        reason: `x402 service "${info.name}" trust score (${info.trust_score}) is below minimum (${trustData.min_trust_score})`,
      };
    }

    // High-value payments require verified services
    if (trustData.require_verified_for_high_value) {
      const txValue = BigInt(ctx.transaction.value || "0");
      const threshold = BigInt(trustData.high_value_threshold);

      if (txValue > threshold && !info.verified) {
        return {
          allow: false,
          reason: `x402 service "${info.name}" is not verified. High-value payments (>${threshold} wei) require verified services`,
        };
      }
    }

    const result: PolicyResult & { metadata?: Record<string, unknown> } = {
      allow: true,
      metadata: {
        service_name: info.name,
        trust_score: info.trust_score,
        verified: info.verified,
        category: info.category,
      },
    };
    return result;
  },
};
