#!/usr/bin/env zsh
# Lightweight smoke test for napphovol server
# Usage: ./scripts/smoke_test.sh

BASE="http://localhost:5000"
PID_FILE="/tmp/napphovol.pid"

echo "==== Server PID ===="
if [[ -f $PID_FILE ]]; then
  PID=$(cat $PID_FILE)
  ps -p $PID -o pid,comm,args || echo "Process $PID not running"
else
  echo "PID file not found: $PID_FILE"
fi

echo "\n==== Latest access token (truncated) ===="
curl -sS "$BASE/api/latest-access-token" | sed -n '1,10p'

# helper to call an endpoint and show status + snippet
call() {
  local url=$1
  local name=$2
  local tmp
  tmp=$(mktemp /tmp/napp_test.XXXXXX) || tmp=$(mktemp)
  trap 'rm -f "$tmp"' RETURN
  http_status=$(curl -sS -w "%{http_code}" -o "$tmp" "$url" || echo "000")
  echo "\n-- $name -> HTTP $http_status -> $url"
  if [[ "$http_status" == "200" ]]; then
    if command -v jq >/dev/null 2>&1; then
      jq '.' "$tmp" | sed -n '1,20p'
    else
      head -c 1000 "$tmp" | sed -n '1,20p'
    fi
  else
    echo "Response body:"; cat "$tmp" | sed -n '1,200p'
  fi
  rm -f "$tmp" || true
  trap - RETURN
}

# 1) basic endpoints
call "$BASE/debug/token-info" "debug/token-info"
call "$BASE/list-scim-accounts" "list-scim-accounts"

# attempt to choose an accountKey from scim accounts (if jq present)
ACCOUNTKEY=""
if command -v jq >/dev/null 2>&1; then
  ACCOUNTKEY=$(curl -sS "$BASE/list-scim-accounts" | jq -r '.accounts[0].value // empty')
fi
if [[ -z "$ACCOUNTKEY" ]]; then
  echo "No accountKey found from SCIM; continuing without explicit accountKey."
  call "$BASE/phone-numbers-summary" "phone-numbers-summary (no accountKey)"
else
  echo "Using accountKey: $ACCOUNTKEY"
  call "$BASE/phone-numbers-summary?accountKey=$ACCOUNTKEY" "phone-numbers-summary (accountKey)"
fi

# 2) persisted DB pagination
call "$BASE/db/phone-numbers?page=1&pageSize=10" "db/phone-numbers page=1"

# 3) recent errors
call "$BASE/debug/recent-errors" "debug/recent-errors"

echo "\nSmoke test complete. No automated assertions performed; inspect outputs above for anomalies."
exit 0
