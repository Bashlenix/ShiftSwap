#!/usr/bin/env bash
# Smoke-tests a running ShiftSwap Compose stack. Usage: scripts/smoke-stack.sh [base-url]
set -euo pipefail

# SMOKE_FORWARDER=true: the stack runs with ALLOW_CODESPACE_ORIGINS=true (dev container
# override), so forwarder-shaped requests must work. Otherwise (plain `docker compose up`)
# they must be rejected. COMPOSE_FILES: extra `-f` flags for docker compose commands.
BASE="${1:-http://localhost:5173}"
FORWARDER="${SMOKE_FORWARDER:-false}"
COMPOSE_FILES="${COMPOSE_FILES:-}"
ORIGIN="http://localhost:5173"
EMAIL="anna@shiftswap.test"
PASSWORD="ShiftSwap-Demo-2026"
JAR="$(mktemp)"
TUNNEL_JAR="$(mktemp)"
ADMIN_JAR="$(mktemp)"
trap 'rm -f "$JAR" "$TUNNEL_JAR" "$ADMIN_JAR"' EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

sign_in() {
  code -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-in/email"
}

# Request shaped like the GitHub Codespaces port forwarder: it rewrites the browser Origin
# to https://localhost:5173 and sends X-Forwarded-Proto: https (the Vite proxy appends
# its own hop). Only trusted when the stack runs with ALLOW_CODESPACE_ORIGINS=true.
tunnel() {
  curl -s -o /dev/null -w '%{http_code}' -b "$TUNNEL_JAR" -c "$TUNNEL_JAR" \
    -H 'Origin: https://localhost:5173' -H 'X-Forwarded-Proto: https' \
    -H 'Sec-Fetch-Site: same-origin' -H 'Sec-Fetch-Mode: cors' "$@"
}

# True (exit 0) when the text contains any demo account email (all use @shiftswap.test).
logs_leak_emails() { grep -qiE 'shiftswap\.test' <<<"$1"; }

# True (exit 0) when the text contains the given invite token verbatim.
logs_leak_token() { grep -qF -- "$2" <<<"$1"; }

# True (exit 0) when the text contains the redacted invite route. Positive control for
# logs_leak_token: without it, "no token in the logs" could pass although nothing was logged.
logs_show_redacted_invite() { grep -qF -- '/api/v1/invites/:token' <<<"$1"; }

# Signs in Maria (admin of Café Lindenhof; Anna is an employee and may not add people).
# Sign-in is rate limited per IP (3 per 10 s): on 429 wait for the window and retry once.
admin_sign_in() {
  local status i
  for i in 1 2; do
    status="$(code -c "$ADMIN_JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
      -d "{\"email\":\"maria@shiftswap.test\",\"password\":\"$PASSWORD\"}" \
      "$BASE/api/auth/sign-in/email")"
    [ "$status" = "429" ] && [ "$i" = "1" ] && { sleep 11; continue; }
    echo "$status"
    return
  done
}

# Creates an invited placeholder as Maria and prints the token from its link.
# Runs before the api restart: demo data resets on start, so the extra member is gone after.
invite_token() {
  local org body
  org="$(curl -s -b "$ADMIN_JAR" "$BASE/api/v1/me" | grep -oE '"organizationId":"[^"]+"' | head -1 | cut -d'"' -f4)"
  body="$(curl -s -b "$ADMIN_JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"displayName\":\"Smoke Invitee\",\"email\":\"smoke.invitee@shiftswap.test\",\"appOrigin\":\"$ORIGIN\"}" \
    "$BASE/api/v1/orgs/$org/members")"
  grep -oE '/invites/[A-Za-z0-9_-]+' <<<"$body" | head -1 | cut -d/ -f3
}

main() {
  [ "$(code "$BASE/login")" = "200" ] && pass "GET /login -> 200" || fail "GET /login"

  [ "$(code "$BASE/mailpit/")" = "200" ] && pass "GET /mailpit/ -> 200" || fail "GET /mailpit/"

  [ "$(sign_in)" = "200" ] && pass "sign-in -> 200" || fail "sign-in"

  me="$(curl -s -b "$JAR" "$BASE/api/v1/me")"
  grep -q 'Café Lindenhof' <<<"$me" \
    && pass "/api/v1/me lists Café Lindenhof" || fail "/api/v1/me missing Café Lindenhof"

  if [ "$FORWARDER" = "true" ]; then
    [ "$(tunnel "$BASE/api/auth/get-session")" = "200" ] \
      && pass "forwarder-shaped get-session -> 200" || fail "forwarder-shaped get-session"
    [ "$(tunnel -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-in/email")" = "200" ] \
      && pass "forwarder-shaped sign-in -> 200" || fail "forwarder-shaped sign-in"
    [ "$(tunnel "$BASE/api/v1/me")" = "200" ] \
      && pass "forwarder-shaped /api/v1/me -> 200" || fail "forwarder-shaped /api/v1/me"
    [ "$(tunnel -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/sign-out")" = "200" ] \
      && pass "forwarder-shaped sign-out -> 200" || fail "forwarder-shaped sign-out"
  else
    # Flag off: forwarder-only and Codespace origins must not be trusted.
    [ "$(tunnel -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-in/email")" = "403" ] \
      && pass "https://localhost:5173 origin rejected -> 403" || fail "https://localhost:5173 origin not rejected"
    [ "$(code -H 'Origin: https://attacker-5173.app.github.dev' -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-in/email")" = "403" ] \
      && pass "Codespace-style origin rejected -> 403" || fail "Codespace-style origin not rejected"
  fi

  [ "$(admin_sign_in)" = "200" ] && pass "admin sign-in -> 200" || fail "admin sign-in"
  token="$(invite_token || true)"
  [ -n "$token" ] && pass "invite created" || fail "invite not created"
  [ "$(code "$BASE/api/v1/invites/$token")" = "200" ] \
    && pass "invite preview -> 200" || fail "invite preview"

  echo "Restarting api..."
  # shellcheck disable=SC2086 # COMPOSE_FILES is a list of flags
  docker compose $COMPOSE_FILES restart api
  for _ in $(seq 1 60); do
    # shellcheck disable=SC2086
    [ "$(docker compose $COMPOSE_FILES ps api --format '{{.Health}}')" = "healthy" ] && break
    sleep 2
  done
  echo "Waiting 12s so the sign-in rate limit window resets..."
  sleep 12

  [ "$(sign_in)" = "200" ] && pass "sign-in after api restart -> 200" || fail "sign-in after restart"

  # Capture first: `cmd | grep -q` under pipefail can report the wrong result (SIGPIPE).
  # shellcheck disable=SC2086
  api_logs="$(docker compose $COMPOSE_FILES logs api 2>&1)"
  if logs_leak_emails "$api_logs"; then
    fail "api logs contain demo emails"
  fi
  pass "api logs contain no demo emails"
  if logs_leak_token "$api_logs" "$token"; then
    fail "api logs contain the invite token"
  fi
  pass "api logs contain no invite token"
  logs_show_redacted_invite "$api_logs" \
    && pass "api logs contain the redacted invite path" \
    || fail "api logs lack /api/v1/invites/:token (the token check proves nothing)"
  echo "ALL CHECKS PASSED"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main; fi
