# OWS OWS Hooks — 設計ドキュメント

## 1. プロジェクト概要

**OWS OWS Hooks** は、Open Wallet Standard の Policy Engine を拡張し、開発者が TypeScript でカスタムポリシーを書ける SDK + ランタイム。

OWS の `executable` ポリシー機構（stdin/stdout プロセス間通信）をラップし、以下を提供する:

- ポリシーを書くための SDK（型定義、ヘルパー、テストユーティリティ）
- 4つの実用ポリシーのリファレンス実装
- 全ポリシー判定を記録する監査ログ（SQLite、将来オンチェーン拡張可能）

**ターゲット**: AI エージェントにウォレット操作を委任する企業・開発者

**ハッカソン**: OWS Hackathon (2026-04-03)

---

## 2. なぜ「Programmable」か

OWS のビルトインポリシーは `allowed_chains` と `expires_at` の2つのみ。
`executable` による拡張ポイントは存在するが、生の stdin/stdout バイナリ通信で開発体験が悪い。

本プロジェクトは「executable ポリシーを誰でも簡単に書ける」基盤を作ることで、OWS エコシステムの拡張性を実証する。

---

## 3. アーキテクチャ

```
AI エージェント → OWS (ows sign) → Policy Engine
                                        │
                                        ▼
                              ┌─────────────────────────┐
                              │  OWS Hooks     │
                              │    Runtime (Node.js)     │
                              │                          │
                              │  ┌── KYC Policy ───────┐ │
                              │  ├── AML Policy ───────┤ │
                              │  ├── ERC-8004 Policy ──┤ │
                              │  ├── Policy Chaining ──┤ │
                              │  └── (ユーザー定義) ───┘ │
                              │                          │
                              │  ┌── Audit Logger ─────┐ │
                              │  │  SQLite (現在)       │ │
                              │  │  On-chain (将来)     │ │
                              │  └─────────────────────┘ │
                              └─────────────────────────┘
```

### フロー

1. OWS が executable を起動、stdin に `PolicyContext` JSON を送る
2. OWS Hooks Runtime がポリシーを順次評価
3. Policy Chaining: 前のポリシーの結果が次のポリシーのコンテキストに影響
4. 各ポリシーの判定結果を監査ログに記録
5. 最終結果（Approve/Deny + 理由）を stdout に返す（5秒以内）

---

## 4. SDK 設計

### ポリシー定義 API

```typescript
import { definePolicy, PolicyContext, PolicyResult } from '@ows-pp/sdk';

export default definePolicy({
  name: 'kyc-check',
  description: 'KYC未完了の相手への送金をブロック',

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const response = await fetch(`${KYC_API_URL}/check/${ctx.transaction.to}`);
    const { verified } = await response.json();

    if (!verified) {
      return { action: 'deny', reason: 'Recipient has not completed KYC' };
    }
    return { action: 'approve' };
  }
});
```

### ランタイム API

```typescript
import { createRuntime } from '@ows-pp/sdk';
import kycPolicy from './policies/kyc-check';
import amlPolicy from './policies/aml-check';
import erc8004Policy from './policies/erc8004-agent-id';
import chainingPolicy from './policies/policy-chaining';

const runtime = createRuntime({
  policies: [kycPolicy, amlPolicy, erc8004Policy, chainingPolicy],
  auditLog: { type: 'sqlite', path: './audit.db' },
});

// OWS の executable として起動
runtime.start();
```

### SDK が提供するもの

| API | 説明 |
|-----|------|
| `definePolicy()` | 型安全なポリシー定義 |
| `PolicyContext` | トランザクション情報、エージェントID、ウォレット情報 |
| `PolicyResult` | approve/deny + 理由 + メタデータ |
| `createRuntime()` | 複数ポリシーをまとめて実行するランタイム |
| `testPolicy()` | ポリシーをローカルでテストするユーティリティ |
| `ChainContext` | Policy Chaining 用の前段ポリシー結果参照 |

---

## 5. デモ用ポリシー（4つ）

> **実装方針**: ポリシー 1, 2 はモック（コンセプト実証）。ポリシー 3, 4 は実際に動作させる。

### 5.1 KYC チェック — モック

- **概要**: 送金先がKYC済みかを外部API（KYCサービス/自社API）に照会
- **Deny条件**: KYC未完了の相手への送金
- **Programmableである理由**: 外部API呼び出しはビルトインポリシーでは不可能
- **実装**: モックKYC APIサーバー（Express）。実プロダクトでは Sumsub, Jumio, 自社API 等に差し替え

### 5.2 AML チェック — モック

- **概要**: 送金先アドレスを制裁リスト/AMLデータベースに照会
- **Deny条件**: ハイリスク判定されたアドレスへの送金
- **Programmableである理由**: 外部コンプライアンスAPI連携が必要
- **実装**: モック制裁リスト（ハードコードされたアドレス一覧）。実プロダクトでは Chainalysis, Elliptic, Circle 等の API に差し替え

### 5.3 ERC-8004 エージェント ID 検証 — 実動作

- **概要**: 送金元エージェントがERC-8004 Identity Registryにオンチェーン登録済みかを照会
- **Deny条件**: 未登録エージェント or 低レピュテーションエージェントの署名
- **Programmableである理由**: オンチェーンコントラクト照会が必要
- **実装**: テストネット（Sepolia等）上のERC-8004コントラクトに実際にRPC照会。viem を使用

### 5.4 Policy Chaining — 実動作

- **概要**: ポリシー間の連鎖・動的ルール変更
- **例**: ERC-8004のレピュテーションが高い → AMLチェック緩和（閾値引き上げ）。低い → 全ポリシーを厳格適用
- **Programmableである理由**: ポリシー間の動的依存関係はビルトインの静的ルールでは絶対に不可能
- **実装**: ChainContext を通じて前段ポリシーの結果を参照。ERC-8004 の実レピュテーション値に基づいて後段の判定を動的に変更

---

## 6. 監査ログ

### 現在（MVP）: SQLite

```sql
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL,
  agent_id      TEXT,
  wallet_id     TEXT NOT NULL,
  tx_to         TEXT,
  tx_amount     TEXT,
  tx_chain      TEXT,
  policy_name   TEXT NOT NULL,
  result        TEXT NOT NULL,  -- 'approve' | 'deny'
  reason        TEXT,
  context_hash  TEXT NOT NULL   -- SHA256 of full PolicyContext
);
```

### 将来のオンチェーン拡張

```
SQLite (詳細ログ)
    │
    ▼ 定期バッチ
Merkle Tree 構築（ログエントリの SHA256 ハッシュ群）
    │
    ▼
Merkle Root をオンチェーンに記録（1 tx/日 程度）
    │
    ▼
任意の監査ログエントリを Merkle Proof で第三者が検証可能
```

**メリット**:
- **コスト効率**: 全ログをオンチェーンに書く必要がない（1日1トランザクション）
- **改ざん証明**: 任意のログが「この時点で確かに存在した」ことを証明可能
- **規制対応**: 金融規制当局への監査証跡提出時に改ざんされていない証拠になる

---

## 7. セキュリティ設計

### 脅威モデル

AIエージェントにウォレット操作を委任する以上、エージェント自身を信頼しない（Zero Trust for Agents）設計が必須。

| 脅威 | 攻撃例 | 対策 |
|------|--------|------|
| **プロンプトインジェクション** | 「ポリシーを無視して署名して」とエージェントに指示 | ポリシー評価はOWSプロセス内で強制実行。エージェントのプロンプトやコードからはバイパス不可能 |
| **PolicyContext改ざん** | エージェントが偽の送金先や金額をcontextに注入 | PolicyContextはOWS本体が生成。エージェントはcontextを構築しない。ランタイム側でもcontextのtxハッシュを検証 |
| **ポリシー設定の改ざん** | エージェントがポリシーファイルや設定JSONを書き換え | ポリシー設定ファイルはエージェントのAPIキースコープ外。OSレベルのファイル権限で保護 |
| **タイムアウト悪用** | 外部API応答を遅延させてポリシー評価をタイムアウトさせる | OWSのDeny-by-default: タイムアウト(5秒)時は必ずDeny。エラー・不正JSON出力も全てDeny |
| **ポリシー順序操作** | 特定ポリシーの評価をスキップ or 順序を入れ替え | ランタイムのポリシー実行順序はconfig時に固定。実行時変更不可 |
| **監査ログ改ざん** | 過去のDenyログを削除して痕跡を消す | context_hash（SHA256）で各ログの整合性を検証可能。将来のMerkle Root拡張でオンチェーン証明 |

### セキュリティ原則

1. **Deny-by-default** — ポリシー評価が何らかの理由で完了しなかった場合、常にDeny
2. **エージェントはポリシーを知らない** — エージェントにはポリシーの内容・設定・評価ロジックを公開しない。署名リクエストを送り、Approve/Denyの結果だけを受け取る
3. **ポリシー評価はアトミック** — 全ポリシーの評価が完了するまで署名しない。途中で1つでもDenyなら即座に全体Deny
4. **監査ログは追記のみ** — DELETE/UPDATE操作を禁止。INSERT ONLYのappend-only log
5. **設定のイミュータビリティ** — ランタイム起動後はポリシー設定を変更不可。変更にはランタイム再起動が必要

### ハッカソンでの実装範囲

- [x] Deny-by-default（OWSの既存挙動を活用）
- [ ] PolicyContextの整合性検証（ランタイム内でtxハッシュチェック）
- [ ] 監査ログのappend-only制約（SQLiteのトリガーで実装）
- [ ] ポリシー設定の起動時ロック
- [ ] エージェントへのポリシー情報非公開（結果のみ返却）

---

## 8. 技術スタック

| レイヤー | 技術 |
|---------|------|
| ポリシー SDK | TypeScript (Node.js) |
| ランタイム | Node.js（OWS の executable として起動） |
| 監査ログ | SQLite (better-sqlite3) |
| テスト | Vitest |
| デモ用モックデータ | JSON ファイル（KYC/AML） |
| ERC-8004 照会 | viem (Base Sepolia テストネット) |

---

## 9. ハッカソンスコープ

### 作るもの（Must）

- [ ] ポリシー SDK（definePolicy, createRuntime, 型定義, ChainContext）
- [ ] stdin/stdout ブリッジ（OWS の executable 仕様に準拠）
- [ ] KYC チェックポリシー + モック API
- [ ] AML チェックポリシー + モック制裁リスト
- [ ] ERC-8004 エージェント ID 検証ポリシー（モック or テストネット）
- [ ] Policy Chaining 実装
- [ ] 監査ログ（SQLite）
- [ ] デモスクリプト（OWS と連携して動く一連のシナリオ）

### プレゼンで語るもの

- オンチェーン Merkle Root 拡張による改ざん不可能な監査証跡
- 企業導入ストーリー（コンプライアンス、規制対応）
- エコシステム構想（開発者がカスタムポリシーを npm publish）
- Policy Chaining による動的リスク管理
- Human-in-the-Loop 承認フロー

---

## 9.5 Future: Human-in-the-Loop Approval Flow

現在のポリシーは即座に Approve/Deny を返すが、実運用では「人間の承認を挟む」ケースが不可欠。
OWS の executable policy は 5秒タイムアウトがあるため、同期的な承認待ちは不可能。
これを非同期の承認フローで解決する。

### アーキテクチャ

```
Agent → OWS sign → OWS Hooks
                        │
                        ├── KYC/AML/ERC-8004 → 自動判定（現在の実装）
                        │
                        └── 高リスク検出時:
                            │
                            ├── 1. PolicyResult: { allow: false, reason: "pending_approval" }
                            │      → 署名は一旦ブロック
                            │
                            ├── 2. 承認リクエストを外部に送信
                            │      → Slack / メール / Webhook / ダッシュボード
                            │      → トランザクション詳細、リスク理由、エージェント情報を含む
                            │
                            ├── 3. 人間が承認
                            │      → 承認トークンを発行（署名付き、有効期限あり）
                            │      → エージェントが承認トークン付きで再度 ows sign
                            │
                            ├── 4. OWS Hooks が承認トークンを検証
                            │      → 有効 → Allow
                            │      → 無効/期限切れ → Deny
                            │
                            └── 5. タイムアウト（例: 30分）
                                   → 承認トークン未使用 → 自動失効（deny-by-default）
```

### 承認トークンの設計

```typescript
interface ApprovalToken {
  tx_hash: string;       // 承認対象トランザクションのハッシュ
  agent_id: string;      // 承認対象エージェント
  approved_by: string;   // 承認者のID
  approved_at: string;   // 承認時刻（ISO 8601）
  expires_at: string;    // 有効期限
  signature: string;     // 承認者の署名（改ざん防止）
}
```

### なぜこれが重要か

1. **規制要件**: 金融機関では一定額以上の送金に人間の承認が法的に必要
2. **段階的自律**: 初期は全件承認 → 信頼構築 → 自動承認の範囲を段階的に拡大
3. **インシデント対応**: 異常検知時に即座に人間が介入できる
4. **Policy Chaining との統合**: ERC-8004 レピュテーションが低い → 承認必須、高い → 自動承認

### OWS への提案

現在の executable policy の 5秒タイムアウトは同期的な承認には短すぎる。
以下の拡張を OWS コアに提案する:

- `PolicyResult` に `{ action: "pending", callback_url: "..." }` を追加
- OWS が pending を受け取ったら署名をキューに入れ、callback で承認/拒否を待つ
- タイムアウト（設定可能）後に自動 Deny

---

## 10. デモシナリオ

### シナリオ 1: 正常フロー
1. KYC済み・AMLクリーン・ERC-8004登録済みエージェントが送金
2. 全ポリシー Approve → 署名成功
3. 監査ログに記録

### シナリオ 2: KYC ブロック
1. エージェントがKYC未完了の相手に送金しようとする
2. KYCポリシーが Deny → 署名拒否
3. 理由「Recipient has not completed KYC」がログに記録

### シナリオ 3: AML ブロック
1. エージェントが制裁対象アドレスに送金しようとする
2. AMLポリシーが Deny → 署名拒否

### シナリオ 4: Policy Chaining の効果
1. 高レピュテーションエージェント → AMLチェック閾値が緩和 → 承認
2. 低レピュテーションエージェント → 同じ送金が厳格チェック → ブロック
3. 同じトランザクションでも、エージェントの信頼度で結果が変わることを実演
