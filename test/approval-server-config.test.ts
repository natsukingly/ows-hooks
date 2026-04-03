import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

function runApprovalServerImport(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "-e", 'import "./src/approval-server.ts";'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APPROVAL_SERVER_AUTOSTART: "false",
        ...env,
      },
      encoding: "utf-8",
    },
  );
}

describe("approval-server startup config", () => {
  it("fails fast when HITL_OPERATOR_TOKEN is missing", () => {
    const result = runApprovalServerImport({
      HITL_OPERATOR_TOKEN: undefined,
      HITL_HMAC_SECRET: "test-hmac-secret",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HITL_OPERATOR_TOKEN is required for approval-server");
  });

  it("fails fast when HITL_HMAC_SECRET is missing", () => {
    const result = runApprovalServerImport({
      HITL_OPERATOR_TOKEN: "operator-token-test",
      HITL_HMAC_SECRET: undefined,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HMAC secret");
  });
});
