import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sanctionedPath = path.join(__dirname, "../../data/sanctioned.json");
const sanctionedList: { sanctioned_addresses: string[] } = JSON.parse(
  readFileSync(sanctionedPath, "utf-8"),
);

const sanctionedSet = new Set(
  sanctionedList.sanctioned_addresses.map((a) => a.toLowerCase()),
);

export const amlCheck: Policy = {
  name: "aml-check",

  async evaluate(ctx: PolicyContext, _chainResults: ChainResults): Promise<PolicyResult> {
    const to = ctx.transaction.to.toLowerCase();

    if (sanctionedSet.has(to)) {
      return {
        allow: false,
        reason: `Recipient ${ctx.transaction.to} is on the sanctions list`,
      };
    }

    return { allow: true };
  },
};
