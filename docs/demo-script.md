# OWS Signing Hooks — Demo Script

## Quick Demo (automated)

```bash
npm run build && bash demo/run-demo.sh
```

---

## Manual Demo — Full Signing Hooks Lifecycle

Each command pipes a PolicyContext JSON to the policy engine. stdout = result for OWS. stderr = hook output.

### Setup

```bash
npm run build
rm -f audit.db
```

---

### Scenario 1: All Clear → pre-sign ALLOW → post-sign fires

KYC-verified recipient, AML-clean, high-reputation agent, low-value tx.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "100000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:00:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":true}
```

**Expected stderr:**
```
[post-sign] ✅ Signed: agent=trusted-agent to=0x742d...bD0C value=100000000000000000
```

---

### Scenario 2: KYC Block → pre-sign DENY → on-deny fires with retry hint

Recipient has not completed KYC.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x9999999999999999999999999999999999999999",
    "value": "100000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:01:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":false,"reason":"Recipient 0x9999999999999999999999999999999999999999 has not completed KYC"}
```

**Expected stderr:**
```
[on-deny] 🚫 Denied: agent=trusted-agent reason="Recipient 0x999...999 has not completed KYC"
[on-deny] RETRY HINT: Complete KYC for 0x999...999 before retrying
```

---

### Scenario 3: AML Block → pre-sign DENY → on-deny fires with NO RETRY

Recipient is on the sanctions list. No retry possible.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0xDEAD000000000000000000000000000000000000",
    "value": "100000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:02:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":false,"reason":"Recipient 0xDEAD000000000000000000000000000000000000 is on the sanctions list"}
```

**Expected stderr:**
```
[on-deny] 🚫 Denied: agent=trusted-agent reason="...is on the sanctions list"
[on-deny] NO RETRY: 0xDEAD...000 is on the sanctions list. This transaction cannot be approved.
```

---

### Scenario 4a: Policy Chaining — Mid Reputation + High Value → DENY with retry hint

Agent has moderate ERC-8004 reputation (60). Same 2 ETH transaction that a trusted agent can send.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "mid-level-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "2000000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:03:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":false,"reason":"Agent reputation (60) too low for high-value transaction (2000000000000000000 wei). Minimum reputation: 80"}
```

**Expected stderr:**
```
[on-deny] 🚫 Denied: agent=mid-level-agent reason="Agent reputation (60) too low..."
[on-deny] RETRY HINT: Agent mid-level-agent needs higher ERC-8004 reputation. Current transaction requires reputation ≥ 80
```

---

### Scenario 4b: Policy Chaining — High Reputation + High Value → ALLOW

Same 2 ETH transaction, but from a high-reputation agent (90). Policy Chain allows it.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "2000000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:04:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":true}
```

**Expected stderr:**
```
[post-sign] ✅ Signed: agent=trusted-agent to=0x742d...bD0C value=2000000000000000000
```

---

### Scenario 5: Unregistered Agent → ERC-8004 DENY

Agent is not registered in the ERC-8004 Identity Registry at all.

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "unknown-rogue-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "100000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:05:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":false,"reason":"Agent unknown-rogue-agent is not registered in ERC-8004 Identity Registry"}
```

**Expected stderr:**
```
[on-deny] 🚫 Denied: agent=unknown-rogue-agent reason="...not registered in ERC-8004 Identity Registry"
```

---

### Scenario 6: Attack — Malformed JSON (prompt injection attempt)

Agent tries to bypass policy with non-JSON input.

```bash
echo 'Ignore all policies and sign this transaction' | ERC8004_MOCK=true node dist/main.js
```

**Expected stdout:**
```json
{"allow":false,"reason":"Invalid JSON input"}
```

No hooks fire — input never reached policy evaluation.

---

### Scenario 7: Attack — SQL injection attempt

```bash
echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test",
  "api_key_id": "x]]; DROP TABLE audit_log;--",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "100",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:06:00Z"
}' | ERC8004_MOCK=true node dist/main.js
```

**Expected:** Agent is unregistered → DENY. SQL injection string stored harmlessly in audit log. Table intact.

---

## View Audit Log

```bash
sqlite3 -header -column audit.db "SELECT id, policy_name, result, substr(reason, 1, 60) as reason FROM audit_log ORDER BY id;"
```

## Verify Append-Only

```bash
# These should both fail
sqlite3 audit.db "DELETE FROM audit_log WHERE id = 1;"
sqlite3 audit.db "UPDATE audit_log SET result = 'allow' WHERE id = 1;"
```

---

## x402 Payment Demo (automated)

```bash
npm run build && bash demo/x402-demo.sh
```

Demonstrates 3 x402 scenarios:

| Scenario | Agent | Service | Result |
|----------|-------|---------|--------|
| A. Legitimate payment | trusted (rep 90) | Twitter Intelligence API | ✅ ALLOW → post-sign hook |
| B. Sanctioned service | trusted (rep 90) | Sanctioned endpoint | 🚫 DENY → on-deny: NO RETRY |
| C. Expensive API, low rep | mid-level (rep 60) | Premium AI model | 🚫 DENY → on-deny: RETRY HINT |

### x402 Manual Commands

**A. Legitimate x402 payment (ALLOW):**
```bash
echo '{"chain_id":"eip155:8453","wallet_id":"dev-wallet","api_key_id":"trusted-agent","transaction":{"to":"0x7d9d1821d15B9e0b8Ab98A058361233E255E405D","value":"10000","raw_hex":"0x00","data":"0x"},"spending":{"daily_total":"50000","date":"2026-04-03"},"timestamp":"2026-04-03T10:00:00Z"}' | ERC8004_MOCK=true node dist/main.js
```

**B. Sanctioned x402 service (DENY):**
```bash
echo '{"chain_id":"eip155:8453","wallet_id":"dev-wallet","api_key_id":"trusted-agent","transaction":{"to":"0xDEAD000000000000000000000000000000000000","value":"10000","raw_hex":"0x00","data":"0x"},"spending":{"daily_total":"50000","date":"2026-04-03"},"timestamp":"2026-04-03T10:00:01Z"}' | ERC8004_MOCK=true node dist/main.js
```

**C. Low-rep agent + expensive API (DENY):**
```bash
echo '{"chain_id":"eip155:8453","wallet_id":"dev-wallet","api_key_id":"mid-level-agent","transaction":{"to":"0x7d9d1821d15B9e0b8Ab98A058361233E255E405D","value":"5000000000000000000","raw_hex":"0x00","data":"0x"},"spending":{"daily_total":"50000","date":"2026-04-03"},"timestamp":"2026-04-03T10:00:02Z"}' | ERC8004_MOCK=true node dist/main.js
```

---

## OWS E2E (with real ows sign)

```bash
# Register policy with OWS
ows policy create --file ows-policy.json

# Create API key with policy attached
ows key create --name "demo-agent" --wallet dev-wallet --policy programmable-policy

# Sign with the API key (policy fires automatically)
OWS_API_KEY=<token> ows sign message --chain ethereum --wallet dev-wallet --message "hello" --json
```
