# OWS Programmable Policy — 実装計画

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

## 進捗

| フェーズ | ステータス |
|---------|-----------|
| 1. OWS動作確認 & ブリッジ | ✅ 完了 |
| 2. 評価エンジン & 監査ログ | ✅ 完了 |
| 3. モックポリシー | ✅ 完了 |
| 4. ERC-8004（実動作） | ✅ Base Sepolia 実接続完了 |
| 5. Policy Chaining（実動作） | ✅ 完了 |
| 6. デモ & 統合 | ✅ 完了 |
| 7. ドキュメント & 提出 | ✅ 完了 |
