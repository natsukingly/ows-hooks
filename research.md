# Research: JSON Config for Policies & Hooks

## Current Architecture

### Policy Registration (hardcoded in main.ts:14-21)
- `Policy[]` 配列がハードコードされている
- 各ポリシーは `{ name: string, evaluate: PolicyFn }` インターフェース
- 評価順序 = 配列の並び順（先頭から順に実行、1つでも deny → 即終了）

### Hook Registration (hardcoded in main.ts)
- `postSignHooks` と `onDenyHooks` がそれぞれ配列で直書き
- hooks は `(ctx: PolicyContext, result: PolicyResult) => Promise<void>` 型
- 失敗しても結果に影響しない（非ブロッキング）

### Available Policies (7個)
| File | name | Export |
|------|------|--------|
| `tx-safety.ts` | `"tx-safety"` | `txSafety` |
| `kyc-check.ts` | `"kyc-check"` | `kycCheck` |
| `aml-check.ts` | `"aml-check"` | `amlCheck` |
| `erc8004-agent.ts` | `"erc8004-agent"` | `erc8004Agent` |
| `policy-chain.ts` | `"policy-chain"` | `policyChain` |
| `hitl-approval.ts` | `"hitl-approval"` | `hitlApproval` |
| `x402-trust.ts` | `"x402-trust"` | `x402Trust` |

### Available Hooks (individual functions, not named)
- `post-sign.ts` exports: `postSignHooks: PostSignHook[]` (demoLog, externalAuditLog, slackNotification)
- `on-deny.ts` exports: `onDenyHooks: OnDenyHook[]` (demoLog, conditionalRetryGuidance, alertOnDeny, slackAlertOnDeny)

### ows-policy.json (OWS CLI registration file)
- OWS CLI に登録するためのファイル（executable パスを指定）
- 内部のポリシー構成を制御するものではない
- `rules` は空配列、`config` は null

## Key Constraints

1. **Policy の順序が重要**: `policy-chain` は `erc8004-agent` の結果に依存する
2. **hitl-approval** も `erc8004-agent` の reputation を参照する
3. hooks はファイル内で個別の関数として定義されている（named export ではない）
4. ESM (`"type": "module"`) プロジェクト

## Design Decisions

### Hooks の粒度
hooks の個別関数を外部から選択するのは粒度が細かすぎる。
**hooks はファイル単位で ON/OFF** が現実的（各ファイルが配列をエクスポート）。

→ 将来的に個別 ON/OFF したいなら hooks にも `{ name, execute }` を持たせればよいが、今回はスコープ外。

### Config file の名前
`ows-policy.json` は OWS CLI 用なので変更しない。
内部設定は **`ows-hooks.json`** という別ファイルにする。

### 動的 import は不要
全ポリシーは TypeScript でビルド済み。JSON から名前で引くレジストリ（Map）を作れば十分。
外部ファイルの動的 `import()` は複雑になるだけで今は不要。
