# OWS Hooks — Implementation Plan

> 設計ドキュメント: [docs/design.md](docs/design.md)
> ハッカソン: 2026-04-03（1日）

## 設計思想

**OWSのexecutable policy機構に乗る最小限の実装。**
独自SDK・独自ランタイムは作らない。OWSが呼ぶNode.jsスクリプトとポリシー関数群だけ。

```
OWS Policy Engine
  → executable（1つのNode.jsエントリポイント）
    → ポリシー関数を順次呼び出し
    → 監査ログに記録
    → Approve/Deny を返す
```

---

## ディレクトリ構成

```
ows-programmable-policy/
├── src/
│   ├── main.ts            # エントリポイント（stdin→評価→stdout）
│   ├── types.ts           # PolicyContext, PolicyResult の型（OWS仕様準拠）
│   ├── evaluate.ts        # ポリシー順次評価 + Chaining
│   ├── audit.ts           # SQLite監査ログ
│   └── policies/
│       ├── kyc-check.ts       # モック
│       ├── aml-check.ts       # モック
│       ├── erc8004-agent.ts   # 実動作
│       └── policy-chain.ts    # 実動作
├── test/
├── demo/                  # デモ用シェルスクリプト
├── data/
│   ├── sanctioned.json    # AMLモック制裁リスト
│   └── kyc-registry.json  # KYCモック登録済みリスト
├── docs/
└── package.json
```

---

## フェーズ 1: OWS動作確認 & 最小ブリッジ（~1h）

- [x] 1.1 OWS CLIインストール & ウォレット作成
- [x] 1.2 最小のexecutable policy（stdin読む→固定Approve返す）でOWSとの疎通確認
- [x] 1.3 プロジェクト初期化（TypeScript, better-sqlite3, viem）
- [x] 1.4 `src/types.ts` — OWSのPolicyContext/PolicyResult型を定義（OWSソースから正確に写す）
- [x] 1.5 `src/main.ts` — stdin→JSON parse→evaluate()→stdout のブリッジ

---

## フェーズ 2: ポリシー評価エンジン & 監査ログ（~1h）

- [x] 2.1 `src/evaluate.ts` — ポリシー関数の配列を順次実行
- [x] 2.2 `src/audit.ts` — SQLite監査ログ（append-only制約付き）
- [x] 2.3 main.ts にevaluate + auditを統合

---

## フェーズ 3: モックポリシー（KYC + AML）（~30min）

- [x] 3.1 `data/kyc-registry.json` — KYC済みアドレスの一覧
- [x] 3.2 `src/policies/kyc-check.ts` — JSONファイルを読んで照合
- [x] 3.3 `data/sanctioned.json` — 制裁対象アドレスの一覧
- [x] 3.4 `src/policies/aml-check.ts` — JSONファイルを読んで照合
- [x] 3.5 テスト

---

## フェーズ 4: ERC-8004 エージェントID検証 — 実動作（~1.5h）

- [ ] 4.1 ERC-8004コントラクトの調査（ABI, デプロイ済みアドレス）
- [x] 4.2 `src/policies/erc8004-agent.ts` — viem でIdentity Registry照会（モックフォールバック付き）
- [x] 4.3 テスト（モックモードで検証済み）
- [x] 4.4 フォールバック: モック切り替え実装済み
- [x] 4.5 Base Sepolia テストネット実接続確認済み（Identity + Reputation Registry）

---

## フェーズ 5: Policy Chaining — 実動作（~30min）

- [x] 5.1 `src/policies/policy-chain.ts` — ChainContextから前段結果を参照
- [x] 5.2 evaluate.ts のChainContext伝播が正しく動くことを検証
- [x] 5.3 テスト: 同じトランザクションでもエージェントの信頼度で結果が変わる

---

## フェーズ 6: デモ & 統合（~1.5h）

- [x] 6.1 OWSにexecutable policyとして登録
- [x] 6.2 デモスクリプト（5シナリオ）
- [x] 6.3 監査ログの表示（全シナリオのログが残っていることを確認）
- [x] 6.4 `ows sign` からの E2E 発火確認
- [x] 6.5 Vitest 13テスト全パス

---

## フェーズ 7: ドキュメント & 提出（~1h）

- [x] 7.1 README.md（概要、セットアップ、デモ実行方法）
- [x] 7.2 セキュリティ設計の説明（Zero Trust for Agents）
- [x] 7.3 将来の拡張（オンチェーンMerkle Root、承認フロー、エコシステム構想）

---

## Phase 8: Rename to "OWS Hooks"

Rebrand from "OWS Programmable Policy" to "OWS Hooks" — the project is a hooks framework, not just a single policy.

### Tasks

- [ ] 8.0a GitHub repo rename: `ows-programmable-policy` → `ows-hooks` (via `gh repo rename`)
- [ ] 8.0b Update `package.json` name field to `ows-hooks`
- [ ] 8.0c Update README.md title and all references
- [ ] 8.0d Update `ows-policy.json` if it references the old name
- [ ] 8.0e Update docs/ references
- [ ] 8.0f Update demo scripts if they reference old paths
- [ ] 8.0g Commit and push rename changes

---

## Phase 9: Human-in-the-Loop Approval (Pattern 1: Polling)

### Design

OWS policy is a stateless executable (stdin → stdout). There's no native `pending` state.
We use a **Deny → Approve → Retry** pattern:

```
1st request:  Agent → Policy → high-value detected → DENY (reason: "PENDING_APPROVAL")
                                                    → on-deny hook sends Slack notification
Human approves: Slack button / CLI → approval record saved to SQLite

2nd request:  Agent → Policy → high-value detected → approval found → ALLOW
```

### Security Concerns (KNOWN LIMITATIONS)

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Approval replay | HIGH | tx_hash binds to exact (to, value, chain_id). Single-use. | Implement |
| Unauthenticated API | HIGH | HMAC token required to approve | Implement |
| TTL too long | MEDIUM | Default 15 min, configurable | Implement |
| Slack token leak | MEDIUM | Channel access = approval access | Document only |
| No approver identity verification | MEDIUM | No cryptographic proof of who approved | Document as future work |
| Infinite retry | LOW | Max retries tracked per approval | Implement |
| DB tampering | LOW | Append-only triggers on approvals table | Implement |
| No multi-party approval (M-of-N) | LOW | Single approver only | Document as future work |

### Tasks

- [ ] 9.1 `src/approval.ts` — Approval DB table + CRUD + HMAC token generation/verification
  - `approvals` table in existing audit.db
  - Schema: id, tx_hash, agent_id, wallet_id, chain_id, tx_to, tx_value, status, requested_at, expires_at, approved_by, approved_at, hmac
  - Append-only triggers (no DELETE/UPDATE)
  - TTL validation (default 15 min via `HITL_APPROVAL_TTL_MINUTES`)
  - HMAC-SHA256 signing with `HITL_HMAC_SECRET` env var

- [ ] 9.2 `src/policies/hitl-approval.ts` — HITL policy
  - Position: after policy-chain, before x402-trust
  - Trigger condition: tx value > threshold AND agent reputation < 80
  - Logic:
    1. Compute tx_hash = SHA256(to + value + chain_id)
    2. Query approvals table for matching approved record
    3. If valid approval found → allow, mark as used
    4. If no approval → create pending record, deny with `PENDING_APPROVAL:<approval_id>`
  - Security: verify HMAC on approval record, check expiry, check single-use

- [ ] 9.3 `src/approval-server.ts` — Lightweight approval HTTP API
  - Node.js built-in `http` module (no Express)
  - `POST /approve/:id` — requires `Authorization: Bearer <hmac_token>` header
  - `GET /pending` — list pending approvals
  - `GET /health` — health check
  - Runs as separate process: `node dist/approval-server.js`

- [ ] 9.4 Extend on-deny hook for HITL notifications
  - Detect `PENDING_APPROVAL` in deny reason
  - Send Slack message with approval ID and instructions
  - Include approval command in stderr retry guidance

- [ ] 9.5 Register hitl-approval in main.ts policy chain
  - Insert after policy-chain (position 5), before x402-trust

- [ ] 9.6 `scripts/approve.sh` — CLI tool for manual approval
  - Usage: `bash scripts/approve.sh <approval_id>`
  - Computes HMAC and calls approval API

- [ ] 9.7 Tests for HITL
  - Approval token CRUD (create, verify, expire, single-use)
  - HITL policy (deny without approval, allow with approval, expired token, replay blocked)
  - Integration: full pipeline with HITL

- [ ] 9.8 Update demo/run-demo.sh with HITL scenarios
  - Scenario 6: High-value tx → DENY (PENDING_APPROVAL) → approve → retry → ALLOW
  - Scenario 7: Expired approval → DENY

- [ ] 9.9 Update README.md
  - Add HITL section with architecture diagram
  - Document security concerns table (same as above)
  - Document known limitations and future work
  - Add env vars: HITL_HMAC_SECRET, HITL_APPROVAL_TTL_MINUTES, HITL_VALUE_THRESHOLD, APPROVAL_SERVER_PORT

- [ ] 9.10 Add code-level security comments
  - Each security concern documented as `// SECURITY:` comment at the relevant code location
  - `// KNOWN LIMITATION:` for issues we chose not to solve
  - `// FUTURE:` for proposed improvements

---

## Progress

| Phase | Status |
|-------|--------|
| 1. OWS bridge | ✅ Done |
| 2. Evaluation engine & audit | ✅ Done |
| 3. Mock policies | ✅ Done |
| 4. ERC-8004 (on-chain) | ✅ Done |
| 5. Policy Chaining | ✅ Done |
| 6. Demo & integration | ✅ Done |
| 7. Docs & submission | ✅ Done |
| 8. Rename to OWS Hooks | 🔧 In Progress |
| 9. Human-in-the-Loop | ⏳ Waiting |
