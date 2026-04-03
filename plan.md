# Plan: JSON Config for Policies & Hooks

## Goal

`ows-hooks.json` で使用するポリシーとhooksを宣言的に設定できるようにする。
コードを読まなくても「何が動くか」が一目でわかる状態にする。

## Config Format

```jsonc
// ows-hooks.json
{
  "policies": [
    "tx-safety",
    "aml-check",
    "erc8004-agent",
    "policy-chain",
    "hitl-approval",
    "x402-trust"
  ],
  "hooks": {
    "post-sign": ["demo-log", "external-audit", "slack-notify"],
    "on-deny":   ["demo-log", "retry-guidance", "alert-webhook", "slack-alert"]
  }
}
```

**ポイント:**
- `policies` の配列順 = 評価順序（先頭から実行）
- `hooks` は種別（post-sign / on-deny）ごとに名前で指定
- JSON にないポリシー/hooks は実行されない
- ファイルがなければ現在のハードコードと同じ動作（後方互換）

## Implementation

### Phase 10: JSON Config Support

#### 10.1 Policy Registry (`src/registry.ts` — new file)
全ポリシーを name → Policy の Map に登録する。

```typescript
import { txSafety } from "./policies/tx-safety.js";
import { amlCheck } from "./policies/aml-check.js";
// ... all policies

const policyRegistry = new Map<string, Policy>([
  ["tx-safety", txSafety],
  ["aml-check", amlCheck],
  ["erc8004-agent", erc8004Agent],
  ["policy-chain", policyChain],
  ["hitl-approval", hitlApproval],
  ["x402-trust", x402Trust],
  ["kyc-check", kycCheck],
]);
```

#### 10.2 Hook Registry (same file or `src/registry.ts`)
hooks にも name を付けて Map に登録する。

現状の hooks は名前なしの関数なので、各ファイルで named export に変更する必要がある。

**post-sign.ts の変更:**
```typescript
// Before: const externalAuditLog: PostSignHook = ...
// After:
export const postSignHookRegistry = new Map<string, PostSignHook>([
  ["demo-log", demoLog],
  ["external-audit", externalAuditLog],
  ["slack-notify", slackNotification],
]);

// 後方互換: 全部入りの配列も残す
export const postSignHooks: PostSignHook[] = [...postSignHookRegistry.values()];
```

**on-deny.ts も同様。**

#### 10.3 Config Loader (`src/config.ts` — new file)
```typescript
interface HooksConfig {
  policies: string[];
  hooks: {
    "post-sign"?: string[];
    "on-deny"?: string[];
  };
}

function loadConfig(): HooksConfig | null {
  // ows-hooks.json を読む。なければ null（デフォルト動作）
}

function resolvePolicies(config: HooksConfig | null): Policy[] {
  // config あり → 名前で registry から引く（不明な名前はエラー）
  // config なし → 現在のハードコード順序
}

function resolveHooks(config: HooksConfig | null): { postSign, onDeny } {
  // 同様
}
```

#### 10.4 main.ts の変更
```typescript
// Before:
const policies: readonly Policy[] = Object.freeze([txSafety, amlCheck, ...]);

// After:
const config = loadConfig();
const policies = resolvePolicies(config);
const { postSign, onDeny } = resolveHooks(config);
```

imports が大幅に減り、main.ts がスッキリする。

#### 10.5 README.md 更新
- Configuration セクションを追加
- `ows-hooks.json` のサンプルを掲載
- 各ポリシー/hooks の名前一覧表

#### 10.6 Tests
- config あり → 指定したポリシーだけが実行される
- config なし → 現在と同じ全ポリシー実行（後方互換）
- 不明なポリシー名 → わかりやすいエラー

---

## TODO

- [x] 10.1 `src/registry.ts` — Policy registry (Map)
- [x] 10.2 hooks に name を付けて registry 化（post-sign.ts, on-deny.ts 変更）
- [x] 10.3 `src/config.ts` — Config loader + resolver
- [x] 10.4 `src/main.ts` — config-driven に変更
- [x] 10.5 `ows-hooks.json` — default config file 作成
- [x] 10.6 Tests
- [x] 10.7 README.md — Configuration セクション追加

## Scope

- ポリシーの動的 import（外部npmパッケージ等）はスコープ外
- hooks の個別 ON/OFF は今回のスコープ内（name 付き registry）
- `ows-policy.json`（OWS CLI 用）は変更しない
