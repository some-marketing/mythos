#!/usr/bin/env bash
# vault-bootstrap.sh — Idempotent verifier for Sam's AI-private memory vault.
#
# WHAT (this script — open-air, reviewable):
#   1. Confirm the operator's vault item "Service Account Auth Token: sam"
#      exists and yields a credential string.
#   2. Use that token (in env only, never argv) to confirm Sam's
#      service-account session works by listing the vault `Sam's Memories`.
#   3. Print PASS or FAIL with a one-line reason. Exit 0 on PASS.
#
# HOW (runtime — local secrecy):
#   - Token is fetched into a shell-local var (NOT exported except for the
#     duration of one `op` call), then unset. EXIT/INT/TERM/HUP trap clears
#     all secret vars on any exit path. Token bytes never appear in argv,
#     stdout, stderr, or this script's log lines.
#   - The script runs entirely on the operator's machine. No frontier API
#     call sees credential bytes.
#
# Usage:
#   bash tools/memory/vault-bootstrap.sh
#
# Pre-req:
#   - op CLI 2.x signed into operator's personal account
#   - python3 (for stdlib JSON extraction; jq optional, not required here)
#
# Exit codes: 0 PASS, 1 precondition fail, 2 token fetch fail, 3 session fail.
#
# History: prior master-password-path bootstrap (Codex 4-pass-cleared, commit
# 804b79e2) is obsolete since the service-account path was adopted 2026-04-29.
# The master-password mechanics were preserved in `remember-via-vault.sh`'s
# git history if ever needed for DR fallback. This file is now a verifier.

set -euo pipefail

TOKEN_ITEM_TITLE="Service Account Auth Token: sam"
TOKEN_VAULT="Employee"
SAM_VAULT="Sam's Memories"

# ─── Secret-cleanup trap ─────────────────────────────────────────────────────
cleanup_secrets() {
  unset SAM_SA_TOKEN OP_SERVICE_ACCOUNT_TOKEN 2>/dev/null || true
}
on_signal() {
  local sig=$1
  cleanup_secrets
  case "$sig" in
    INT)  exit 130 ;;
    TERM) exit 143 ;;
    HUP)  exit 129 ;;
    *)    exit 1   ;;
  esac
}
trap cleanup_secrets EXIT
trap 'on_signal INT'  INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP'  HUP

say()  { printf '%s\n' "$*"; }
pass() { say "PASS: $*"; exit 0; }
fail() { say "FAIL: $*"; exit "${2:-1}"; }

# ─── Pre-flight ──────────────────────────────────────────────────────────────
command -v op      >/dev/null || fail "op CLI not found" 1
command -v python3 >/dev/null || fail "python3 not found" 1

op whoami --format=json >/dev/null 2>&1 \
  || fail "op CLI not signed in to operator account; run \`op signin\` first" 1

# ─── Stage 1: token presence ────────────────────────────────────────────────
# Lookup by title (durable); ID rotates on revoke+recreate.
# `--reveal --format json` returns a JSON object; python3 extracts .value
# without the token landing in this script's logs/argv.
SAM_SA_TOKEN="$(
  op item get "$TOKEN_ITEM_TITLE" \
    --vault "$TOKEN_VAULT" \
    --reveal \
    --fields credential \
    --format json 2>/dev/null \
  | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    v=d.get("value","")
    print(v)
except Exception:
    pass
' || true
)"

[[ -n "${SAM_SA_TOKEN:-}" ]] \
  || fail "operator vault item \"$TOKEN_ITEM_TITLE\" missing or empty in $TOKEN_VAULT" 2

# ─── Stage 2: Sam's session works ────────────────────────────────────────────
# Export only for the single op call; unset immediately after.
# Discard stdout (it would echo vault metadata which is fine but noisy);
# capture only the return code.
if OP_SERVICE_ACCOUNT_TOKEN="$SAM_SA_TOKEN" op vault list --format=json >/dev/null 2>&1; then
  : # session token is valid
else
  unset SAM_SA_TOKEN OP_SERVICE_ACCOUNT_TOKEN
  fail "service-account token rejected by op (token present but session failed)" 3
fi

# Confirm scope: Sam should be able to list items in `Sam's Memories`.
# Empty list is OK; non-zero rc is not.
if ! OP_SERVICE_ACCOUNT_TOKEN="$SAM_SA_TOKEN" op item list \
       --vault "$SAM_VAULT" --format=json >/dev/null 2>&1; then
  unset SAM_SA_TOKEN OP_SERVICE_ACCOUNT_TOKEN
  fail "session works but vault \"$SAM_VAULT\" not accessible to service account" 3
fi

unset SAM_SA_TOKEN OP_SERVICE_ACCOUNT_TOKEN

pass "service-account token present and Sam's session reaches \"$SAM_VAULT\""
