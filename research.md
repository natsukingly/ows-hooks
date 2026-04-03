# Research: Merkle Root + Human-in-the-Loop

## 1. オンチェーン Merkle Root

### 現状の監査ログ
- SQLite（better-sqlite3）、WAL モード、append-only（DELETE/UPDATE はトリガーで禁止）
- スキーマ: `id, timestamp, agent_id, wallet_id, chain_id, tx_to, tx_value, policy_name, result, reason, context_hash`
- `context_hash` = PolicyContext 全体の SHA256（評価ごとに1回計算、全エントリで共有）
- **エントリ単位のハッシュは未実装** → Merkle Tree の leaf に必要

### やること
1. **各エントリのハッシュ生成**: `SHA256(id || timestamp || agent_id || policy_name || result || reason || context_hash)`
2. **Merkle Tree 構築**: leaf ノード群からバイナリツリーを構築し Root を算出
3. **Root をオンチェーンに記録**: Base Sepolia にコントラクトをデプロイし、Root を書き込む
4. **Merkle Proof 生成・検証**: 任意のエントリが Tree に含まれることを証明

### チェーンインフラ（既存）
- `viem` + `baseSepolia` は erc8004-agent.ts で使用済み
- `createPublicClient` → 読み取り用。**書き込みには `createWalletClient` + アカウントが必要**
- 環境変数: `BASE_SEPOLIA_RPC_URL`

### コントラクト設計（シンプル）
```solidity
contract AuditMerkleRoot {
    event RootAnchored(bytes32 indexed root, uint256 batchId, uint256 entryCount, uint256 timestamp);
    
    mapping(uint256 => bytes32) public roots;  // batchId → merkleRoot
    uint256 public batchCount;
    address public owner;
    
    function anchorRoot(bytes32 root, uint256 entryCount) external onlyOwner {
        roots[batchCount] = root;
        emit RootAnchored(root, batchCount, entryCount, block.timestamp);
        batchCount++;
    }
}
```

### 実装ファイル構成
- `src/merkle.ts` — Merkle Tree 構築 + Proof 生成 + 検証
- `src/anchor.ts` — オンチェーン書き込み（viem walletClient）
- `scripts/anchor-roots.sh` — バッチ実行スクリプト
- `contracts/AuditMerkleRoot.sol` — Solidity コントラクト（デプロイ済みアドレスを使用）

### デモの見せ方
1. デモでポリシー評価を数回実行 → 監査ログにエントリ蓄積
2. `anchor` コマンドで Merkle Root をオンチェーンに書き込み
3. 任意のエントリの Merkle Proof を生成
4. オンチェーンの Root と Proof を使って検証 → ✅ 改ざんされてないことを証明
5. Base Sepolia の Explorer でトランザクションを見せる

---

## 2. Human-in-the-Loop 承認

### 制約
- **OWS の 5 秒タイムアウト**: 同期的な人間の承認は不可能
- **PolicyResult は `{ allow: boolean, reason?: string }` のみ**: "pending" 状態がない
- **stdout に返すのは allow + reason だけ**: metadata は内部利用のみ

### 設計方針: 「Deny → 承認 → Retry」パターン
OWS コアを変更せずに実現できる方法：

```
1回目のリクエスト:
  Agent → Policy → 高額検出 → DENY (reason: "approval_required")
                              → on-deny hook が承認リクエストを送信（Slack/webhook）

人間が承認:
  Slack ボタン or ダッシュボード → 承認トークン生成 → SQLite に保存

2回目のリクエスト（Agent がリトライ）:
  Agent → Policy → 高額検出 → 承認トークン確認 → 有効 → ALLOW
```

### 承認トークン設計
```typescript
interface ApprovalToken {
  id: string;                 // UUID
  tx_hash: string;            // 対象トランザクションのハッシュ
  agent_id: string;           // 対象エージェント
  approved_by: string;        // 承認者 ID
  approved_at: string;        // ISO 8601
  expires_at: string;         // 有効期限（30分）
  signature: string;          // HMAC-SHA256 で改ざん防止
}
```

### 承認の保存先
- `approval_tokens` テーブル（SQLite、既存 audit.db に追加）
- 期限切れトークンは検証時にスキップ

### 実装ファイル構成
- `src/policies/hitl-approval.ts` — 承認ポリシー（高額検出 + トークン検証）
- `src/approval.ts` — トークン生成・保存・検証
- `src/hooks/on-deny.ts` — 既存。承認リクエスト送信ロジックを追加

### ポリシー評価順序（変更後）
```
1. tx-safety
2. aml-check
3. erc8004-agent
4. policy-chain
5. x402-trust
6. hitl-approval  ← NEW（最後に評価。他が全部 allow の場合のみ到達）
```

### hitl-approval ポリシーの判定ロジック
```
1. tx_value < HIGH_VALUE_THRESHOLD → allow（承認不要）
2. tx_value >= HIGH_VALUE_THRESHOLD:
   a. 有効な承認トークンが存在する → allow
   b. 承認トークンがない → deny (reason: "approval_required, request sent")
```

### デモの見せ方
1. 高額トランザクション → DENY + 「承認が必要です」
2. 承認スクリプトを実行（人間が承認するシミュレーション）
3. 同じトランザクションを再送 → ALLOW
4. 期限切れトークンで再送 → DENY
5. 監査ログに全フローが記録されている

---

## 3. 共通の懸念事項

### テスト戦略
- Merkle: Tree 構築 + Proof 検証のユニットテスト
- HITL: トークン生成・検証・期限切れのユニットテスト + 統合テスト
- 既存テスト（19件）が壊れないこと

### 工数見積もり
| タスク | 見積もり |
|--------|---------|
| Merkle Tree（src/merkle.ts） | 1h |
| Anchor コントラクト + デプロイ | 1h |
| Anchor スクリプト（src/anchor.ts） | 30min |
| HITL 承認ポリシー | 1h |
| 承認トークン管理（src/approval.ts） | 1h |
| on-deny hook 拡張 | 30min |
| テスト追加 | 1h |
| デモスクリプト更新 | 1h |
| **合計** | **約7h** |
