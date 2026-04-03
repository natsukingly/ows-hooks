import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, "../../data/kyc-registry.json");
const registry: { verified_addresses: string[] } = JSON.parse(
  readFileSync(registryPath, "utf-8"),
);

// Set for case-insensitive comparison
const verifiedSet = new Set(
  registry.verified_addresses.map((a) => a.toLowerCase()),
);

export const kycCheck: Policy = {
  name: "kyc-check",

  async evaluate(ctx: PolicyContext, _chainResults: ChainResults): Promise<PolicyResult> {
    const to = ctx.transaction.to.toLowerCase();

    if (!verifiedSet.has(to)) {
      return {
        allow: false,
        reason: `Recipient ${ctx.transaction.to} has not completed KYC`,
      };
    }

    return { allow: true };
  },
};
