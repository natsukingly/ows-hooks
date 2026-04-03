#!/usr/bin/env bash
set -euo pipefail

# OWS Hooks Demo Script
# Demonstrates all policies across 5 scenarios

DIR="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_scenario() {
  echo ""
  echo -e "${YELLOW}▶ Scenario $1: $2${NC}"
  echo -e "  $3"
  echo ""
}

run_policy() {
  local result
  result=$(echo "$1" | ERC8004_MOCK=true node "$DIR/dist/main.js" 2>/dev/null)

  local allow
  allow=$(echo "$result" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(String(r.allow))})")
  local reason
  reason=$(echo "$result" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(r.reason||'')})")

  if [ "$allow" = "true" ]; then
    echo -e "  ${GREEN}✓ ALLOW${NC}"
  else
    echo -e "  ${RED}✗ DENY${NC} — $reason"
  fi
}

# ── Reset audit DB ──
rm -f "$DIR/audit.db"

print_header "OWS Hooks — Demo"
echo ""
echo "  5 policies evaluate each signing request in sequence:"
echo "    1. Tx Safety    — Address book, risk score, address poisoning detection"
echo "    2. AML Check    — Is the recipient on the sanctions list? (mock)"
echo "    3. ERC-8004     — Is the agent registered on-chain with sufficient reputation?"
echo "    4. Policy Chain — Dynamic rule adjustment based on upstream policy results"
echo "    5. x402 Trust   — Is the x402 service trustworthy? (for x402 payments)"

# ── Scenario 1: All Clear ──
print_scenario 1 "All Clear" \
  "Trusted address + AML-clean + high-reputation agent + low-value tx"

run_policy '{
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
}'

# ── Scenario 2: KYC Block ──
print_scenario 2 "High-Risk Address" \
  "Recipient flagged as high-risk (risk score 85) → immediate deny"

run_policy '{
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
}'

# ── Scenario 3: AML Block ──
print_scenario 3 "AML Block" \
  "Recipient is on the sanctions list → deny"

run_policy '{
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
}'

# ── Scenario 4a: Policy Chaining — Mid Reputation + High Value ──
print_scenario "4a" "Policy Chaining — Mid Reputation + High Value" \
  "Mid-reputation agent (60) + high-value tx (2 ETH) → Policy Chain denies"

run_policy '{
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
}'

# ── Scenario 4b: Policy Chaining — High Reputation + High Value ──
print_scenario "4b" "Policy Chaining — High Reputation + High Value" \
  "High-reputation agent (90) + same high-value tx (2 ETH) → allowed"

run_policy '{
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
}'

# ── Scenario 5: Address Poisoning Detection ──
print_scenario 5 "Address Poisoning Attack" \
  "Attacker sends from 0x742d...bD00 (looks like Treasury 0x742d...bD0C)"

run_policy '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD00",
    "value": "100000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:05:00Z"
}'

# ── Scenario 6: Human-in-the-Loop — Deny → Approve → Allow ──
print_header "Human-in-the-Loop Approval"

print_scenario 6 "HITL — High Reputation + Critical Value (no approval)" \
  "High-reputation agent (90) + 10 ETH (critical) → requires human approval → DENY"

HITL_RESULT=$(echo '{
  "chain_id": "eip155:1",
  "wallet_id": "test-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
    "value": "10000000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "0", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:06:00Z"
}' | ERC8004_MOCK=true node "$DIR/dist/main.js" 2>/dev/null)

HITL_REASON=$(echo "$HITL_RESULT" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(r.reason||'')})")
echo -e "  ${RED}✗ DENY${NC} — ${HITL_REASON:0:80}..."

# Extract approval ID and token
APPROVAL_ID=$(echo "$HITL_REASON" | node -e "process.stdin.on('data',d=>{const m=String(d).match(/PENDING_APPROVAL:([a-f0-9-]+):/);process.stdout.write(m?m[1]:'')})")
APPROVAL_TOKEN=$(echo "$HITL_REASON" | node -e "process.stdin.on('data',d=>{const m=String(d).match(/PENDING_APPROVAL:[a-f0-9-]+:([a-f0-9]+)/);process.stdout.write(m?m[1]:'')})")

if [ -n "$APPROVAL_ID" ]; then
  print_scenario "6b" "HITL — Human approves via SQLite" \
    "Simulating human approval (normally via approval-server API)"

  # Directly approve in DB (simulates the approval server)
  sqlite3 "$DIR/audit.db" "UPDATE approvals SET status='approved', approved_by='demo-operator', approved_at='$(date -u +%Y-%m-%dT%H:%M:%SZ)' WHERE id='$APPROVAL_ID';"
  echo -e "  ${YELLOW}⏳ Approved by demo-operator${NC}"

  print_scenario "6c" "HITL — Retry after approval" \
    "Same transaction retried → approval found → ALLOW"

  run_policy '{
    "chain_id": "eip155:1",
    "wallet_id": "test-wallet",
    "api_key_id": "trusted-agent",
    "transaction": {
      "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
      "value": "10000000000000000000",
      "raw_hex": "0x00",
      "data": "0x"
    },
    "spending": { "daily_total": "0", "date": "2026-04-03" },
    "timestamp": "2026-04-03T10:07:00Z"
  }'

  print_scenario "6d" "HITL — Replay blocked (single-use)" \
    "Same transaction again → approval already used → DENY"

  REPLAY_RESULT=$(echo '{
    "chain_id": "eip155:1",
    "wallet_id": "test-wallet",
    "api_key_id": "trusted-agent",
    "transaction": {
      "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0C",
      "value": "10000000000000000000",
      "raw_hex": "0x00",
      "data": "0x"
    },
    "spending": { "daily_total": "0", "date": "2026-04-03" },
    "timestamp": "2026-04-03T10:08:00Z"
  }' | ERC8004_MOCK=true node "$DIR/dist/main.js" 2>/dev/null)

  REPLAY_ALLOW=$(echo "$REPLAY_RESULT" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(String(r.allow))})")
  REPLAY_REASON=$(echo "$REPLAY_RESULT" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(r.reason||'')})")

  if [ "$REPLAY_ALLOW" = "true" ]; then
    echo -e "  ${GREEN}✓ ALLOW${NC}"
  else
    echo -e "  ${RED}✗ DENY${NC} — ${REPLAY_REASON:0:80}..."
  fi
fi

# ── Audit Log ──
print_header "Audit Log"
echo ""

if command -v sqlite3 &>/dev/null; then
  sqlite3 -header -column "$DIR/audit.db" \
    "SELECT id, policy_name, result, substr(reason, 1, 60) as reason FROM audit_log ORDER BY id;"
else
  echo "  sqlite3 not found. Run: sqlite3 audit.db 'SELECT * FROM audit_log;'"
fi

# ── Approvals Table ──
if command -v sqlite3 &>/dev/null; then
  echo ""
  print_header "Approval Log"
  echo ""
  sqlite3 -header -column "$DIR/audit.db" \
    "SELECT id, status, agent_id, approved_by, substr(expires_at, 1, 19) as expires_at FROM approvals ORDER BY requested_at;" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}Demo complete.${NC}"
