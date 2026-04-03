import { describe, it, expect, vi } from "vitest";
import { resolveConfig, validateConfig, type HooksConfig } from "../src/config.js";
import { policyRegistry } from "../src/registry.js";

describe("resolveConfig", () => {
  it("returns defaults when config is null", () => {
    const resolved = resolveConfig(null);

    expect(resolved.policies.length).toBeGreaterThan(0);
    expect(resolved.postSignHooks.length).toBeGreaterThan(0);
    expect(resolved.onDenyHooks.length).toBeGreaterThan(0);

    const names = resolved.policies.map((p) => p.name);
    expect(names).toEqual([
      "tx-safety",
      "aml-check",
      "erc8004-agent",
      "policy-chain",
      "hitl-approval",
      "x402-trust",
    ]);
  });

  it("resolves pre-sign hooks in the specified order", () => {
    const config: HooksConfig = {
      "pre-sign": ["aml-check", "tx-safety"],
      "post-sign": ["stderr-log"],
      "on-deny": ["stderr-log"],
    };

    const resolved = resolveConfig(config);

    expect(resolved.policies.map((p) => p.name)).toEqual([
      "aml-check",
      "tx-safety",
    ]);
  });

  it("resolves only specified hooks", () => {
    const config: HooksConfig = {
      "pre-sign": ["aml-check"],
      "post-sign": ["slack-notify"],
      "on-deny": ["alert-webhook"],
    };

    const resolved = resolveConfig(config);
    expect(resolved.postSignHooks).toHaveLength(1);
    expect(resolved.onDenyHooks).toHaveLength(1);
  });

  it("throws on unknown pre-sign hook name", () => {
    const config: HooksConfig = {
      "pre-sign": ["nonexistent-policy"],
    };

    expect(() => resolveConfig(config)).toThrow('Unknown policy "nonexistent-policy"');
  });

  it("throws on unknown post-sign hook name", () => {
    const config: HooksConfig = {
      "pre-sign": ["aml-check"],
      "post-sign": ["nonexistent-hook"],
    };

    expect(() => resolveConfig(config)).toThrow('Unknown hook "nonexistent-hook"');
  });

  it("uses defaults when sections are omitted", () => {
    const config: HooksConfig = {
      "pre-sign": ["aml-check"],
    };

    const resolved = resolveConfig(config);
    expect(resolved.postSignHooks.length).toBeGreaterThan(0);
    expect(resolved.onDenyHooks.length).toBeGreaterThan(0);
  });

  it("all registered policies are in the registry", () => {
    const knownNames = [
      "tx-safety", "kyc-check", "aml-check",
      "erc8004-agent", "policy-chain", "hitl-approval", "x402-trust",
    ];
    for (const name of knownNames) {
      expect(policyRegistry.has(name)).toBe(true);
    }
  });

  it("validateConfig throws on unknown keys", () => {
    expect(() => validateConfig({ "pre_sign": ["aml-check"] })).toThrow('unknown key "pre_sign"');
  });

  it("validateConfig throws on non-array values", () => {
    expect(() => validateConfig({ "pre-sign": "aml-check" })).toThrow('"pre-sign" must be an array');
  });

  it("validateConfig accepts valid config", () => {
    expect(() => validateConfig({ "pre-sign": ["aml-check"], "post-sign": ["stderr-log"] })).not.toThrow();
  });

  it("warns on empty pre-sign array", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const config: HooksConfig = {
      "pre-sign": [],
    };

    const resolved = resolveConfig(config);
    expect(resolved.policies).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("pre-sign is empty"),
    );
    spy.mockRestore();
  });
});
