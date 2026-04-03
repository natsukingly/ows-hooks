#!/usr/bin/env bash
set -euo pipefail

# OWS Hooks — Manual Approval CLI
# Usage: bash scripts/approve.sh <approval_id> <token> [approved_by]
#
# The approval_id and token are printed in the deny reason when HITL triggers.
# Example:
#   PENDING_APPROVAL:abc-123:deadbeef... — High-value transaction requires human approval.
#
# Arguments:
#   approval_id  — UUID from the PENDING_APPROVAL deny reason
#   token        — HMAC token from the PENDING_APPROVAL deny reason
#   approved_by  — (optional) Your name/identifier. Default: "operator"

if [ $# -lt 2 ]; then
  echo "Usage: bash scripts/approve.sh <approval_id> <token> [approved_by]"
  echo ""
  echo "Example:"
  echo "  bash scripts/approve.sh abc-123-def token123 alice"
  exit 1
fi

APPROVAL_ID="$1"
TOKEN="$2"
APPROVED_BY="${3:-operator}"
PORT="${APPROVAL_SERVER_PORT:-3001}"

echo "Approving: ${APPROVAL_ID}"
echo "Approver:  ${APPROVED_BY}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:${PORT}/approve/${APPROVAL_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"approved_by\": \"${APPROVED_BY}\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Approved successfully"
  echo "$BODY" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
else
  echo "✗ Approval failed (HTTP ${HTTP_CODE})"
  echo "$BODY"
  exit 1
fi
