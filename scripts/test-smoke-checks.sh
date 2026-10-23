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
