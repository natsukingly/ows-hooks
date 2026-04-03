#!/usr/bin/env bash
set -euo pipefail

# OWS Programmable Policy Demo Script
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

print_header "OWS Programmable Policy — Demo"
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

# ── Audit Log ──
print_header "Audit Log"
echo ""

if command -v sqlite3 &>/dev/null; then
  sqlite3 -header -column "$DIR/audit.db" \
    "SELECT id, policy_name, result, substr(reason, 1, 60) as reason FROM audit_log ORDER BY id;"
else
  echo "  sqlite3 not found. Run: sqlite3 audit.db 'SELECT * FROM audit_log;'"
fi

echo ""
echo -e "${GREEN}Demo complete.${NC}"
