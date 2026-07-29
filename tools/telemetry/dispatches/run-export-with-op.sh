#!/usr/bin/env bash
# run-export-with-op.sh — Resolve Langfuse credentials from 1Password and exec the
# P3a orchestrator-span exporter with them in env. Key bytes never appear in argv,
# in this script's stdout, or in any persistent file — they live only in the child
# process env. Mirrors tools/mcp/meta-ads/run-with-op.sh (same SA-token path).
#
# Usage:
#   tools/telemetry/dispatches/run-export-with-op.sh --trace latest --enable
#   tools/telemetry/dispatches/run-export-with-op.sh --trace <id> --enable --json
#   tools/telemetry/dispatches/run-export-with-op.sh --trace latest        # dry-run
#
# Credential resolution (in order; first that yields both keys wins):
#   1. LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY already in env (caller supplied).
#   2. 1Password service account:
#        OP_SERVICE_ACCOUNT_TOKEN already in env, OR
#        macOS Keychain item mythos-1p-automation-token (account mythos),
#      then `op read op://Automation/mythos-langfuse-api/{Public Key,credential}`.
#   3. Desktop-app `op` session (interactive prompt) — legacy fallback.
#
# Host default: tailnet Langfuse (override with LANGFUSE_HOST). On the VPS itself
# pass LANGFUSE_HOST=http://localhost:3000.
#
# Field names match the P1.5 verifier: Public Key -> public, credential -> secret.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXPORTER="${REPO_ROOT}/tools/telemetry/dispatches/export-to-langfuse.mjs"

OP_ITEM="${MYTHOS_LANGFUSE_OP_ITEM:-mythos-langfuse-api}"
OP_VAULT="${MYTHOS_LANGFUSE_OP_VAULT:-Automation}"
OP_FIELD_PUBLIC="${MYTHOS_LANGFUSE_OP_FIELD_PUBLIC:-Public Key}"
OP_FIELD_SECRET="${MYTHOS_LANGFUSE_OP_FIELD_SECRET:-credential}"

# Default to the tailnet host; operator can override (e.g. localhost on the VPS).
export LANGFUSE_HOST="${LANGFUSE_HOST:-http://${TELEMETRY_HOST:-localhost}:3000}"

# --- Service-account token (headless, vault-scoped) ---
if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
  OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -a mythos -s mythos-1p-automation-token -w 2>/dev/null || true)"
fi

# Read one op field: prefer the service-account read (Automation vault), fall back
# to a desktop-session read. Never prints the value.
_op_read_auto() {
  local field="$1" out=""
  if [[ -n "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
    out="$(OP_SERVICE_ACCOUNT_TOKEN="${OP_SERVICE_ACCOUNT_TOKEN}" op read "op://${OP_VAULT}/${OP_ITEM}/${field}" 2>/dev/null || true)"
  fi
  if [[ -z "${out}" ]]; then
    out="$(op read "op://${OP_VAULT}/${OP_ITEM}/${field}" 2>/dev/null || true)"
  fi
  printf '%s' "${out}"
}

if [[ -z "${LANGFUSE_PUBLIC_KEY-}" ]]; then
  LANGFUSE_PUBLIC_KEY="$(_op_read_auto "${OP_FIELD_PUBLIC}")"
fi
if [[ -z "${LANGFUSE_SECRET_KEY-}" ]]; then
  LANGFUSE_SECRET_KEY="$(_op_read_auto "${OP_FIELD_SECRET}")"
fi

# Strip stray non-printable bytes (web-copy artifacts) defensively.
LANGFUSE_PUBLIC_KEY="$(printf '%s' "${LANGFUSE_PUBLIC_KEY-}" | LC_ALL=C tr -cd '!-~')"
LANGFUSE_SECRET_KEY="$(printf '%s' "${LANGFUSE_SECRET_KEY-}" | LC_ALL=C tr -cd '!-~')"

# A dry-run (no --enable) does not need keys; only block the live push.
WANTS_ENABLE=0
for a in "$@"; do [[ "$a" == "--enable" ]] && WANTS_ENABLE=1; done

if [[ "${WANTS_ENABLE}" == "1" && ( -z "${LANGFUSE_PUBLIC_KEY}" || -z "${LANGFUSE_SECRET_KEY}" ) ]]; then
  echo "[run-export-with-op] could not resolve Langfuse keys from 1Password item '${OP_ITEM}' (vault ${OP_VAULT})." >&2
  echo "[run-export-with-op] Ensure either OP_SERVICE_ACCOUNT_TOKEN is set, the keychain item" >&2
  echo "  'mythos-1p-automation-token' (account mythos) exists, or 'op signin' has a live session." >&2
  echo "  On the VPS instead: LANGFUSE_HOST=http://localhost:3000 with the keys from ~/stack/.env." >&2
  exit 1
fi

export LANGFUSE_PUBLIC_KEY
export LANGFUSE_SECRET_KEY

exec node "${EXPORTER}" "$@"
