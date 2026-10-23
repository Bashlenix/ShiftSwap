#!/usr/bin/env bash
# Smoke-tests a running ShiftSwap Compose stack. Usage: scripts/smoke-stack.sh [base-url]
set -euo pipefail

BASE="${1:-http://localhost:5173}"
ORIGIN="http://localhost:5173"
EMAIL="anna@shiftswap.test"
PASSWORD="ShiftSwap-Demo-2026"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

sign_in() {
  code -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-in/email"
}

[ "$(code "$BASE/login")" = "200" ] && pass "GET /login -> 200" || fail "GET /login"

[ "$(sign_in)" = "200" ] && pass "sign-in -> 200" || fail "sign-in"

curl -s -b "$JAR" "$BASE/api/v1/me" | grep -q 'Café Lindenhof' \
  && pass "/api/v1/me lists Café Lindenhof" || fail "/api/v1/me missing Café Lindenhof"

echo "Restarting api..."
docker compose restart api
docker compose up -d --wait
echo "Waiting 12s so the sign-in rate limit window resets..."
sleep 12

[ "$(sign_in)" = "200" ] && pass "sign-in after api restart -> 200" || fail "sign-in after restart"

if docker compose logs api 2>&1 | grep -qiE 'anna@|ben@|shiftswap\.test'; then
  fail "api logs contain demo emails"
fi
pass "api logs contain no demo emails"
echo "ALL CHECKS PASSED"
