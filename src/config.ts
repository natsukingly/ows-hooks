import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Policy, PostSignHook, OnDenyHook } from "./types.js";
import {
  policyRegistry,
  postSignHookRegistry,
  onDenyHookRegistry,
  defaultPolicyOrder,
  defaultPostSignHooks,
  defaultOnDenyHooks,
} from "./registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface HooksConfig {
  "pre-sign"?: string[];
  "post-sign"?: string[];
  "on-deny"?: string[];
}

export interface ResolvedConfig {
  policies: readonly Policy[];
  postSignHooks: readonly PostSignHook[];
  onDenyHooks: readonly OnDenyHook[];
}

export function loadConfig(): HooksConfig | null {
  const configPath = path.resolve(__dirname, "..", "ows-hooks.json");
  if (!existsSync(configPath)) return null;

  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as HooksConfig;

  // Validate known keys
  const validKeys = new Set(["pre-sign", "post-sign", "on-deny"]);
  for (const key of Object.keys(config)) {
    if (!validKeys.has(key)) {
      throw new Error(`ows-hooks.json: unknown key "${key}". Valid keys: ${[...validKeys].join(", ")}`);
    }
  }

  // Validate array types
  for (const key of validKeys) {
    const value = config[key as keyof HooksConfig];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`ows-hooks.json: "${key}" must be an array of strings`);
    }
  }

  return config;
}

export function resolveConfig(config: HooksConfig | null): ResolvedConfig {
  if (!config) {
    return {
      policies: resolvePolicies(defaultPolicyOrder),
      postSignHooks: resolveHookList(postSignHookRegistry, defaultPostSignHooks),
      onDenyHooks: resolveHookList(onDenyHookRegistry, defaultOnDenyHooks),
    };
  }

  const preSign = config["pre-sign"] ?? defaultPolicyOrder;
  if (Array.isArray(config["pre-sign"]) && config["pre-sign"].length === 0) {
    console.error("[config] WARNING: pre-sign is empty — all transactions will be allowed with no policy checks");
  }

  return {
    policies: resolvePolicies(preSign),
    postSignHooks: resolveHookList(
      postSignHookRegistry,
      config["post-sign"] ?? defaultPostSignHooks,
    ),
    onDenyHooks: resolveHookList(
      onDenyHookRegistry,
      config["on-deny"] ?? defaultOnDenyHooks,
    ),
  };
}

function resolvePolicies(names: readonly string[]): Policy[] {
  return names.map((name) => {
    const policy = policyRegistry.get(name);
    if (!policy) {
      const available = [...policyRegistry.keys()].join(", ");
      throw new Error(
        `Unknown policy "${name}". Available: ${available}`,
      );
    }
    return policy;
  });
}

function resolveHookList<T>(
  registry: Map<string, T>,
  names: readonly string[],
): T[] {
  return names.map((name) => {
    const hook = registry.get(name);
    if (!hook) {
      const available = [...registry.keys()].join(", ");
      throw new Error(
        `Unknown hook "${name}". Available: ${available}`,
      );
    }
    return hook;
  });
}
