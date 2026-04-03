#!/usr/bin/env bash
set -euo pipefail

# x402 + OWS Signing Hooks Demo
# Simulates x402 payment flow with policy evaluation

DIR="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

run_policy() {
  local result stderr_out
  stderr_out=$(mktemp)
  result=$(echo "$1" | ERC8004_MOCK=true node "$DIR/dist/main.js" 2>"$stderr_out")

  local allow
  allow=$(echo "$result" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(String(r.allow))})")
  local reason
  reason=$(echo "$result" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);process.stdout.write(r.reason||'')})")

  if [ "$allow" = "true" ]; then
    echo -e "  ${GREEN}✓ ALLOW${NC} — Payment signed, API access granted"
  else
    echo -e "  ${RED}✗ DENY${NC} — $reason"
  fi

  # Show hook output
  if [ -s "$stderr_out" ]; then
    echo -e "  ${CYAN}hooks:${NC}"
    while IFS= read -r line; do
      echo -e "    ${CYAN}$line${NC}"
    done < "$stderr_out"
  fi
  rm -f "$stderr_out"
}

rm -f "$DIR/audit.db"

print_header "x402 + OWS Signing Hooks Demo"
echo ""
echo "  x402 flow: Agent → API → HTTP 402 → OWS signs payment → Signing Hooks evaluate"
echo ""
echo "  Scenario: An AI agent tries to pay for x402-enabled API services."
echo "  Every payment signature passes through the pre-sign hooks."

# ── Scenario A: Legitimate x402 payment ──
echo ""
echo -e "${YELLOW}▶ Scenario A: Agent pays for Twitter intelligence API via x402${NC}"
echo -e "  Agent: trusted-agent (ERC-8004 reputation: 90)"
echo -e "  Service: Heurist Twitter Intelligence (0x7d9d...05D)"
echo -e "  Amount: 0.01 USDC on Base"
echo ""
echo -e "  ${CYAN}1. Agent calls API endpoint${NC}"
echo -e "  ${CYAN}2. Server returns HTTP 402 Payment Required${NC}"
echo -e "  ${CYAN}3. OWS generates payment → Signing Hooks evaluate:${NC}"
echo ""

run_policy '{
  "chain_id": "eip155:8453",
  "wallet_id": "dev-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x7d9d1821d15B9e0b8Ab98A058361233E255E405D",
    "value": "10000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "50000", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:00:00Z"
}'

echo ""
echo -e "  ${CYAN}4. Payment signed → X-PAYMENT header sent → API access granted ✅${NC}"

# ── Scenario B: x402 payment to sanctioned service ──
echo ""
echo -e "${YELLOW}▶ Scenario B: Agent tries to pay a sanctioned x402 service${NC}"
echo -e "  Agent: trusted-agent (ERC-8004 reputation: 90)"
echo -e "  Service: SANCTIONED endpoint (0xDEAD...000)"
echo -e "  Amount: 0.01 USDC on Base"
echo ""
echo -e "  ${CYAN}1. Agent calls sanctioned API endpoint${NC}"
echo -e "  ${CYAN}2. Server returns HTTP 402 Payment Required${NC}"
echo -e "  ${CYAN}3. OWS generates payment → Signing Hooks evaluate:${NC}"
echo ""

run_policy '{
  "chain_id": "eip155:8453",
  "wallet_id": "dev-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0xDEAD000000000000000000000000000000000000",
    "value": "10000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "50000", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:00:01Z"
}'

echo ""
echo -e "  ${CYAN}4. Payment BLOCKED — Agent cannot access sanctioned service 🚫${NC}"

# ── Scenario C: Low-reputation agent tries expensive API ──
echo ""
echo -e "${YELLOW}▶ Scenario C: Low-reputation agent tries to pay for expensive API${NC}"
echo -e "  Agent: mid-level-agent (ERC-8004 reputation: 60)"
echo -e "  Service: Premium AI model API"
echo -e "  Amount: 5 USDC (high-value for this agent's reputation)"
echo ""
echo -e "  ${CYAN}1. Agent calls premium API endpoint${NC}"
echo -e "  ${CYAN}2. Server returns HTTP 402 — price: 5 USDC${NC}"
echo -e "  ${CYAN}3. OWS generates payment → Signing Hooks evaluate:${NC}"
echo ""

run_policy '{
  "chain_id": "eip155:8453",
  "wallet_id": "dev-wallet",
  "api_key_id": "mid-level-agent",
  "transaction": {
    "to": "0x7d9d1821d15B9e0b8Ab98A058361233E255E405D",
    "value": "5000000000000000000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "50000", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:00:02Z"
}'

echo ""
echo -e "  ${CYAN}4. Payment BLOCKED — Agent needs higher reputation for expensive APIs 🚫${NC}"

# ── Scenario D: Low trust score x402 service ──
echo ""
echo -e "${YELLOW}▶ Scenario D: Agent tries to pay an untrusted x402 service${NC}"
echo -e "  Agent: trusted-agent (ERC-8004 reputation: 90)"
echo -e "  Service: \"Unverified Scraping Service\" (trust score: 15)"
echo -e "  Amount: 0.01 USDC on Base"
echo ""
echo -e "  ${CYAN}1. Agent finds cheap scraping API via x402 discovery${NC}"
echo -e "  ${CYAN}2. Server returns HTTP 402 Payment Required${NC}"
echo -e "  ${CYAN}3. OWS generates payment → Signing Hooks evaluate:${NC}"
echo ""

run_policy '{
  "chain_id": "eip155:8453",
  "wallet_id": "dev-wallet",
  "api_key_id": "trusted-agent",
  "transaction": {
    "to": "0x2222222222222222222222222222222222222222",
    "value": "10000",
    "raw_hex": "0x00",
    "data": "0x"
  },
  "spending": { "daily_total": "50000", "date": "2026-04-03" },
  "timestamp": "2026-04-03T10:00:03Z"
}'

echo ""
echo -e "  ${CYAN}4. Payment BLOCKED — Service trust score too low 🚫${NC}"

# ── Summary ──
print_header "Summary"
echo ""
echo "  x402 payments flow through the same Signing Hooks as regular transactions."
echo "  This means:"
echo ""
echo "    • Sanctioned services are automatically blocked (AML)"
echo "    • Low-reputation agents can't access expensive APIs (Policy Chaining)"
echo "    • Every payment decision is recorded in the audit log"
echo "    • Post-sign / on-deny hooks fire for notifications and retry guidance"
echo ""
echo "  The agent never touches the private key. The hooks are the gatekeeper."
echo ""

# Show audit log
if command -v sqlite3 &>/dev/null; then
  echo -e "${BLUE}  Audit Log:${NC}"
  sqlite3 -header -column "$DIR/audit.db" \
    "SELECT id, policy_name, result, substr(reason, 1, 55) as reason FROM audit_log ORDER BY id;" | sed 's/^/  /'
fi

echo ""
echo -e "${GREEN}x402 demo complete.${NC}"
