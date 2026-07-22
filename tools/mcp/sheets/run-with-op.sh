#!/usr/bin/env bash
# Resolves the Mythos Google OAuth credentials and execs the inner command with
# them in env. Credential bytes never appear in argv, in this script's stdout, or
# in any persistent file — they live only in the child process env. Mirrors
# tools/mcp/youtube/run-with-op.sh, with an added macOS Keychain fallback.
#
# Per-field resolution order (first non-empty wins):
#   1. 1Password  — op read op://<vault>/<item>/<field>
#   2. Keychain   — security find-generic-password -a mythos -s <service> -w
#   3. Env        — an already-exported SHEETS_* var
#
# Usage:
#   tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
#     --id <spreadsheetId> --range 'Sheet1!A1' --input rows.json --mode update
#
# Defaults (env-overridable):
#   SHEETSOP_VAULT  1Password vault name.  Default: Automation
#   SHEETSOP_ITEM   1Password item name.   Default: mythos-google-oauth-client
#   1Password fields read from the item: "client id", "client secret", "refresh token".
#   Keychain services (account mythos): mythos-google-oauth-client-client-id,
#     mythos-google-oauth-client-client-secret, mythos-google-oauth-client-refresh-token.
#
# One-time prerequisite: the three creds must exist in 1Password OR the Keychain.
# Run tools/mcp/sheets/bootstrap-oauth.js once (operator) to mint + store them.
#
# Auth: 1Password reads require `op` signed in; if `op` is absent/expired the
# resolver silently falls through to Keychain, then to any pre-set env var.

set -euo pipefail

VAULT="${SHEETSOP_VAULT:-Automation}"
ITEM="${SHEETSOP_ITEM:-mythos-google-oauth-client}"

op_field() {
  # $1 = 1Password field label. Tolerates absence (missing op / field).
  command -v op >/dev/null 2>&1 || return 0
  op read "op://${VAULT}/${ITEM}/$1" 2>/dev/null || true
}

keychain_field() {
  # $1 = Keychain generic-password service name (account mythos). Tolerates absence.
  command -v security >/dev/null 2>&1 || return 0
  security find-generic-password -a mythos -s "$1" -w 2>/dev/null || true
}

resolve_field() {
  # $1 = 1Password field label, $2 = Keychain service, $3 = existing env value.
  # Order: 1Password -> Keychain -> env. First non-empty wins.
  local v
  v="$(op_field "$1")"
  if [[ -z "${v}" ]]; then v="$(keychain_field "$2")"; fi
  if [[ -z "${v}" ]]; then v="$3"; fi
  printf '%s' "${v}"
}

SHEETS_CLIENT_ID="$(resolve_field 'client id' 'mythos-google-oauth-client-client-id' "${SHEETS_CLIENT_ID:-}")"
SHEETS_CLIENT_SECRET="$(resolve_field 'client secret' 'mythos-google-oauth-client-client-secret' "${SHEETS_CLIENT_SECRET:-}")"
SHEETS_REFRESH_TOKEN="$(resolve_field 'refresh token' 'mythos-google-oauth-client-refresh-token' "${SHEETS_REFRESH_TOKEN:-}")"

# Strip non-printable bytes that web-copied secrets sometimes carry.
clean() { printf '%s' "$1" | LC_ALL=C tr -cd '!-~'; }
SHEETS_CLIENT_ID="$(clean "${SHEETS_CLIENT_ID}")"
SHEETS_CLIENT_SECRET="$(clean "${SHEETS_CLIENT_SECRET}")"
SHEETS_REFRESH_TOKEN="$(clean "${SHEETS_REFRESH_TOKEN}")"

if [[ -z "${SHEETS_CLIENT_ID}" || -z "${SHEETS_CLIENT_SECRET}" || -z "${SHEETS_REFRESH_TOKEN}" ]]; then
  echo "[run-with-op] Missing OAuth creds. Checked, in order: 1Password item '${ITEM}'" >&2
  echo "[run-with-op] (vault '${VAULT}'), macOS Keychain (account mythos), then env." >&2
  echo "[run-with-op] Need: 'client id', 'client secret', 'refresh token'." >&2
  echo "[run-with-op] Run the one-time bootstrap: tools/mcp/sheets/bootstrap-oauth.js" >&2
  exit 1
fi

export SHEETS_CLIENT_ID SHEETS_CLIENT_SECRET SHEETS_REFRESH_TOKEN

# Default to live when invoked through this wrapper; caller can force dry-run.
: "${SHEETS_DRY_RUN:=false}"
export SHEETS_DRY_RUN

exec "$@"
