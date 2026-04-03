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

  return {
    policies: resolvePolicies(config["pre-sign"] ?? defaultPolicyOrder),
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
