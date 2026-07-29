#!/usr/bin/env bash
# Fetches the Delesign API bearer token from 1Password and execs the inner
# command with it in env. Token bytes never appear in argv, in this script's
# stdout, or in any persistent file — they live only in the child process env.
#
# Usage:
#   tools/mcp/delesign/run-with-op.sh node tools/mcp/delesign/preflight.js
#   tools/mcp/delesign/run-with-op.sh node tools/mcp/delesign/preflight.js --live-check
#   tools/mcp/delesign/run-with-op.sh node tools/mcp/delesign/server.js
#
# Defaults (env-overridable):
#   DELESIGNOP_ITEM   1Password item name. Default: Delesign
#   DELESIGNOP_VAULT  1Password vault name. Default: Employee
#   DELESIGNOP_FIELD  Field on the item containing the bearer token. Default: credential
#
# Auth: requires `op` (1Password CLI) signed in. If the session has expired,
# `op` prints its own prompt to stderr; we exit if that fails so no half-auth
# state propagates to the child.

set -euo pipefail

ITEM="${DELESIGNOP_ITEM:-Delesign}"
VAULT="${DELESIGNOP_VAULT:-Employee}"
FIELD="${DELESIGNOP_FIELD:-credential}"

DELESIGN_API_TOKEN="$(op read "op://${VAULT}/${ITEM}/${FIELD}")"
# Strip anything that is not printable ASCII (0x21–0x7e). 1Password fields
# pasted from web copy can carry stray newlines, tabs, or invisible Unicode
# zero-width characters that turn the Authorization header malformed and
# produce opaque 5xx responses. Keep punctuation; kill control chars + Unicode.
DELESIGN_API_TOKEN_RAW_LEN="${#DELESIGN_API_TOKEN}"
DELESIGN_API_TOKEN="$(printf '%s' "${DELESIGN_API_TOKEN}" | LC_ALL=C tr -cd '!-~')"
DELESIGN_API_TOKEN_CLEAN_LEN="${#DELESIGN_API_TOKEN}"
if [[ "${DELESIGN_API_TOKEN_RAW_LEN}" != "${DELESIGN_API_TOKEN_CLEAN_LEN}" ]]; then
  echo "[run-with-op] WARN: stripped $((DELESIGN_API_TOKEN_RAW_LEN - DELESIGN_API_TOKEN_CLEAN_LEN)) non-printable byte(s) from token; consider re-copying the token in 1Password to remove the hidden character(s)" >&2
fi
unset DELESIGN_API_TOKEN_RAW_LEN DELESIGN_API_TOKEN_CLEAN_LEN
DELESIGN_BASE_URL="$(op read "op://${VAULT}/${ITEM}/DELESIGN_BASE_URL" 2>/dev/null || echo "https://api.delesign.com")"
DELESIGN_API_VERSION="$(op read "op://${VAULT}/${ITEM}/DELESIGN_API_VERSION" 2>/dev/null || echo "v1")"

if [[ -z "${DELESIGN_API_TOKEN}" ]]; then
  echo "[run-with-op] DELESIGN_API_TOKEN empty in 1P item ${ITEM} (vault ${VAULT}, field ${FIELD})" >&2
  exit 1
fi

export DELESIGN_API_TOKEN
export DELESIGN_BASE_URL
export DELESIGN_API_VERSION

# Default to live mode when invoked through this wrapper. Caller can still
# force dry-run by exporting DELESIGN_DRY_RUN=true before invoking.
: "${DELESIGN_DRY_RUN:=false}"
export DELESIGN_DRY_RUN

exec "$@"
