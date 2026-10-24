#!/usr/bin/env bash
# Local unit check for the log-leak detector in smoke-stack.sh (no Docker needed).
set -euo pipefail
source "$(dirname "$0")/smoke-stack.sh"

big="$(printf 'line\n%.0s' {1..20000})"
leak="$big
{\"msg\":\"login\",\"email\":\"anna@shiftswap.test\"}
$big"

logs_leak_emails "$leak" || { echo "FAIL: leak not detected"; exit 1; }
echo "PASS: leak detected"
if logs_leak_emails "$big"; then echo "FAIL: false positive on clean log"; exit 1; fi
echo "PASS: clean log accepted"

token="Abc_123-xyzTOKEN"
logs_leak_token "$big
{\"req\":{\"url\":\"/api/v1/invites/$token\"}}
$big" "$token" || { echo "FAIL: token leak not detected"; exit 1; }
echo "PASS: token leak detected"
if logs_leak_token "$big
{\"req\":{\"url\":\"/api/v1/invites/:token\"}}" "$token"; then
  echo "FAIL: false positive on redacted log"; exit 1
fi
echo "PASS: redacted log accepted"

# Positive control: the redacted route must be present, else "no token" proves nothing.
logs_show_redacted_invite "$big
{\"req\":{\"url\":\"/api/v1/invites/:token\"}}" || { echo "FAIL: redacted path not detected"; exit 1; }
echo "PASS: redacted path detected"
if logs_show_redacted_invite "$big"; then
  echo "FAIL: false positive on log without the invite route"; exit 1
fi
echo "PASS: missing redacted path detected"
