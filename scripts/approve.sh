#!/usr/bin/env bash
set -euo pipefail

# OWS Hooks — Manual Approval CLI
# Usage: HITL_OPERATOR_TOKEN=... bash scripts/approve.sh <approval_id> [approved_by]
#
# The approval_id is printed in the deny reason when HITL triggers.
# Example: PENDING_APPROVAL:abc-123... — High-value transaction requires human approval.
#
# Arguments:
#   approval_id  — UUID from the PENDING_APPROVAL deny reason
#   approved_by  — (optional) Your name/identifier. Default: "operator"
# Environment:
#   HITL_OPERATOR_TOKEN — Required bearer token for approval-server authentication
#   APPROVAL_TOKEN      — Optional per-approval token (x-approval-token header)

if [ $# -lt 1 ]; then
  echo "Usage: HITL_OPERATOR_TOKEN=... bash scripts/approve.sh <approval_id> [approved_by]"
  echo ""
  echo "Example:"
  echo "  HITL_OPERATOR_TOKEN=super-secret bash scripts/approve.sh abc-123-def alice"
  exit 1
fi

APPROVAL_ID="$1"
APPROVED_BY="${2:-operator}"
PORT="${APPROVAL_SERVER_PORT:-3001}"
OPERATOR_TOKEN="${HITL_OPERATOR_TOKEN:-}"
APPROVAL_TOKEN="${APPROVAL_TOKEN:-}"

if [ -z "$OPERATOR_TOKEN" ]; then
  echo "HITL_OPERATOR_TOKEN is required"
  exit 1
fi

echo "Approving: ${APPROVAL_ID}"
echo "Approver:  ${APPROVED_BY}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:${PORT}/approve/${APPROVAL_ID}" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  ${APPROVAL_TOKEN:+-H "x-approval-token: ${APPROVAL_TOKEN}"} \
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
