#!/usr/bin/env bash
# Fetches the target YouTube OAuth credentials from 1Password and execs the inner
# command with them in env. Credential bytes never appear in argv, in this
# script's stdout, or in any persistent file — they live only in the child
# process env.
#
# Usage:
#   tools/mcp/youtube/run-with-op.sh node tools/mcp/youtube/upload.js --file clip.mp4 --title "T"
#
# Defaults (env-overridable):
#   YTOP_VAULT  1Password vault name.  Default: Automation
#   YTOP_ITEM   1Password item name.   Default: YouTube Channel
#   Fields read from the item: "client id", "client secret", "refresh token".
#
# One-time prerequisite: those three fields must exist on the item. The login
# (username/password) alone is NOT enough for API upload — run
# tools/mcp/youtube/bootstrap-oauth.js once (operator) to mint + store them.
#
# Auth: requires `op` (1Password CLI) signed in. If the session has expired,
# `op` prints its own prompt to stderr; we exit so no half-auth state propagates.

set -euo pipefail

VAULT="${YTOP_VAULT:-Automation}"
ITEM="${YTOP_ITEM:-YouTube Channel}"

read_field() {
  # $1 = field label. Tolerates absence so we can give a clear error below.
  op read "op://${VAULT}/${ITEM}/$1" 2>/dev/null || true
}

YT_CLIENT_ID="$(read_field 'client id')"
YT_CLIENT_SECRET="$(read_field 'client secret')"
YT_REFRESH_TOKEN="$(read_field 'refresh token')"

# Strip non-printable bytes that web-copied secrets sometimes carry.
clean() { printf '%s' "$1" | LC_ALL=C tr -cd '!-~'; }
YT_CLIENT_ID="$(clean "${YT_CLIENT_ID}")"
YT_CLIENT_SECRET="$(clean "${YT_CLIENT_SECRET}")"
YT_REFRESH_TOKEN="$(clean "${YT_REFRESH_TOKEN}")"

if [[ -z "${YT_CLIENT_ID}" || -z "${YT_CLIENT_SECRET}" || -z "${YT_REFRESH_TOKEN}" ]]; then
  echo "[run-with-op] Missing OAuth fields on 1P item '${ITEM}' (vault '${VAULT}')." >&2
  echo "[run-with-op] Need fields: 'client id', 'client secret', 'refresh token'." >&2
  echo "[run-with-op] Run the one-time bootstrap: tools/mcp/youtube/bootstrap-oauth.js" >&2
  exit 1
fi

export YT_CLIENT_ID YT_CLIENT_SECRET YT_REFRESH_TOKEN

# Default to live when invoked through this wrapper; caller can force dry-run.
: "${YT_DRY_RUN:=false}"
export YT_DRY_RUN

exec "$@"
