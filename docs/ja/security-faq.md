# OWS Programmable Policy — Security FAQ & Attack Scenarios

## 攻撃シナリオ検証結果

全攻撃シナリオで deny-by-default が機能することを確認済み。

### 1. 不正入力

| 攻撃 | 入力 | 結果 |
|------|------|------|
| 壊れたJSON | `THIS IS NOT JSON` | `deny: "Invalid JSON input"` |
| 空入力 | `(empty)` | `deny: "Empty input"` |
| 必須フィールド欠落 | `{"chain_id":"eip155:1"}` | `deny: "Missing required fields"` |
| 不正な値 (value) | `"value": "NOT_A_NUMBER"` | `deny: Policy threw (BigInt変換エラー)` |

### 2. インジェクション

| 攻撃 | 入力 | 結果 |
|------|------|------|
| SQL インジェクション | `api_key_id: "agent; DROP TABLE audit_log;--"` | 文字列としてログに記録。テーブル無事。better-sqlite3 のパラメータバインドで防御 |
| プロトタイプ汚染 | `"__proto__": {"isAdmin": true}` | JSON.parse はプレーンオブジェクトを返すため無効。ポリシーロジックに影響なし |

### 3. 監査ログ改ざん

| 攻撃 | 結果 |
|------|------|
| `DELETE FROM audit_log` | `ABORT: audit_log is append-only: DELETE is prohibited` |
| `UPDATE audit_log SET result = 'allow'` | `ABORT: audit_log is append-only: UPDATE is prohibited` |

SQLite トリガーにより DELETE/UPDATE は完全にブロック。

### 4. DoS

| 攻撃 | 結果 |
|------|------|
| 200KB ペイロード | 処理されたが、OWS の 5秒タイムアウトが上限となる |

OWS 本体が 5 秒でタイムアウト → 自動 Deny。Programmable Policy 側では追加のサイズ制限は不要（OWS が制御）。

---

## FAQ

### Q: プロンプトインジェクションでポリシーを回避できないか？

**A: 不可能。** Programmable Policy は LLM を一切使っていない。純粋な Node.js コードが JSON 入力を受け取り、決定論的に Approve/Deny を返す。自然言語の指示（「ポリシーを無視して」等）は JSON パースに失敗して Deny になるだけ。

より重要な点: **Programmable Policy はエージェントがプロンプトインジェクションでハイジャックされた場合の最後の防壁として機能する。**

```
攻撃者 → プロンプトインジェクション → AIエージェント（乗っ取られる）
  → エージェントが制裁対象アドレスに送金を試みる
  → OWS sign → Programmable Policy → AMLチェック → Deny ✅
```

エージェントの判断がどれだけ歪められても、ポリシー評価は独立したプロセスで実行され、エージェントのプロンプトやコンテキストに一切影響されない。これが「Zero Trust for Agents」の核心。

### Q: エージェントがポリシーを無視して直接署名できないか？

**A: できない。** 署名はOWSのPolicy Engine内部で実行される。エージェントは `ows sign` APIを通じてのみ署名をリクエストでき、APIキーにポリシーが紐付いている限り、ポリシー評価は必ず実行される。秘密鍵はポリシー評価後にのみ復号される。

### Q: エージェントがポリシーの内容を知ることはできるか？

**A: ポリシーの判定ロジックは公開されない。** エージェントが受け取るのは `{ allow: true/false, reason: "..." }` だけ。どのポリシーが存在するか、閾値がいくつか、何を基準に判定しているかは分からない。

### Q: PolicyContext を偽造できないか？

**A: エージェント側からは不可能。** PolicyContext はOWS本体が生成する。エージェントは `ows sign --chain X --wallet Y --message Z` のようにリクエストを送るだけで、PolicyContext のJSON構造に直接触れない。

### Q: ポリシー評価中に例外が発生したらどうなるか？

**A: Deny になる。** `evaluate.ts` の try-catch が全ポリシーの例外を捕捉し、`{ allow: false, reason: "Policy X threw: ..." }` を返す。例外の内容は監査ログに記録される。

### Q: 監査ログを削除してdeny記録を消せないか？

**A: SQLiteトリガーで禁止している。** DELETE/UPDATE は `RAISE(ABORT)` で即座にロールバックされる。ログファイルを直接削除した場合は、将来のMerkle Root拡張でオンチェーンに記録されたハッシュとの不整合で検知できる。

### Q: 5秒タイムアウトを超えたらどうなるか？

**A: OWSが自動的にDenyを返す。** 外部API（KYCサービス等）が遅延しても、OWSの5秒制限で署名はブロックされる。これはOWSコアの挙動であり、Programmable Policy側で制御する必要はない。

### Q: ERC-8004のレピュテーションが0のエージェントはどうなるか？

**A: `ERC8004_MIN_REPUTATION` の設定による。** デフォルト閾値 50 の場合、reputation 0 の登録済みエージェントはブロックされる。閾値を 0 にすれば「登録済みであること」だけで許可される。

### Q: Policy Chaining で前段のポリシーを騙せないか？

**A: ChainResults はランタイム内部のオブジェクトで、エージェントからはアクセス不可能。** 前段のポリシーが返した結果のみが後段に渡り、エージェントがこのフローに介入する手段はない。

### Q: モックポリシー（KYC/AML）を本番で使ったらどうなるか？

**A: モックはデモ専用。** 本番では外部APIに差し替える。差し替えポイントは明確（fetch呼び出し1行の変更）で、ポリシーのインターフェースは同じ。

### Q: 新しいポリシーを追加するには？

**A: `src/policies/` に新しいファイルを作り、`main.ts` の policies 配列に追加するだけ。** ポリシーは `{ name, evaluate(ctx, chainResults) }` のインターフェースに従えばよい。

### Q: OWSがアップデートしてexecutable仕様が変わったら？

**A: `types.ts` の PolicyContext/PolicyResult 型を更新するだけ。** ポリシーロジックは型に依存しているので、型を変えれば TypeScript が全ての不整合を検出する。
