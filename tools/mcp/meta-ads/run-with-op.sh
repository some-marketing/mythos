#!/usr/bin/env bash
# Fetches Meta Ads MCP credentials from 1Password and execs the inner command
# with them in env. Token bytes never appear in argv, in this script's stdout,
# or in any persistent file — they live only in the child process env.
#
# Usage:
#   tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/server.js
#   tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/preflight.js
#
# Item/vault/field selection (env-overridable; current SM defaults preserved):
#   METAOP_ITEM         1Password item name. Default: "example-meta-ads API Credential" (Automation vault; Employee-vault mythos-meta-ads-mcp token went stale 2026-07-15).
#   METAOP_VAULT        1Password vault name. Default: Automation.
#   METAOP_FIELD_TOKEN  Field on the item containing the access token.
#                        Default: META_ACCESS_TOKEN.
#                        Falls back to "credential" if META_ACCESS_TOKEN
#                        isn't a field on the item.
#   METAOP_FIELD_APP_ID, METAOP_FIELD_APP_SECRET, METAOP_FIELD_AD_ACCOUNT_ID
#                        Optional field overrides; defaults match the env-var name.
#
# For Example Group's BM lane (patron-alpha, patron-beta, patron-gamma — all under one Meta App):
#   METAOP_ITEM="example-meta-ads API Credential" METAOP_VAULT="Employee" \
#   METAOP_FIELD_TOKEN="credential" \
#     tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/preflight.js
#   Ad account ID is supplied per-call from clients/<CLIENT>/projects/meta-app-integration/project.json,
#   not from the 1Password item.
#
# Honours:
#   META_ADS_DRY_RUN (default: respect .env / unset → MCP defaults to dry-run)
#
# Auth: requires `op` (1Password CLI) signed in. If the session has expired,
# `op` will print its own prompt to stderr; we exit if that fails so no half-
# auth state is propagated to the child.

set -euo pipefail

ITEM="${METAOP_ITEM:-example-meta-ads API Credential}"
VAULT="${METAOP_VAULT:-Automation}"

# --- Headless auth (2026-06-10): prefer the mythos-automation service account ---
# Resolution order:
#   1. OP_SERVICE_ACCOUNT_TOKEN already in env (caller/launchd supplied)
#   2. macOS Keychain item mythos-1p-automation-token (account mythos)
#   3. Desktop-app session (interactive authorization prompt) — legacy fallback
# The service account can only see the "Automation" vault, so SA reads target
# that vault first; the configured ${VAULT} is the desktop-session fallback.
SA_VAULT="${METAOP_SA_VAULT:-Automation}"
if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
  OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -a mythos -s mythos-1p-automation-token -w 2>/dev/null || true)"
fi

# Read a field: service-account read from the Automation vault first, then
# desktop-session read from the configured vault. Never prints token bytes.
_op_read_auto() {
  local item="$1" field="$2" out=""
  if [[ -n "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
    out="$(OP_SERVICE_ACCOUNT_TOKEN="${OP_SERVICE_ACCOUNT_TOKEN}" op read "op://${SA_VAULT}/${item}/${field}" 2>/dev/null || true)"
  fi
  if [[ -z "${out}" ]]; then
    out="$(op read "op://${VAULT}/${item}/${field}" 2>/dev/null || true)"
  fi
  printf '%s' "${out}"
}

FIELD_TOKEN="${METAOP_FIELD_TOKEN:-META_ACCESS_TOKEN}"
FIELD_APP_ID="${METAOP_FIELD_APP_ID:-META_APP_ID}"
FIELD_APP_SECRET="${METAOP_FIELD_APP_SECRET:-META_APP_SECRET}"
FIELD_AD_ACCOUNT_ID="${METAOP_FIELD_AD_ACCOUNT_ID:-META_AD_ACCOUNT_ID}"

# op read uses op://<vault>/<item>/<field> URIs.
META_ACCESS_TOKEN="$(_op_read_auto "${ITEM}" "${FIELD_TOKEN}")"
# Fall back to "credential" if the token field doesn't exist on the item.
if [[ -z "${META_ACCESS_TOKEN}" && "${FIELD_TOKEN}" == "META_ACCESS_TOKEN" ]]; then
  META_ACCESS_TOKEN="$(_op_read_auto "${ITEM}" "credential")"
fi

# For the optional fields, only fill from 1Password if the caller hasn't
# already supplied the env var. This lets a caller pass META_AD_ACCOUNT_ID
# inline (e.g. from clients/<CLIENT>/projects/meta-app-integration/project.json)
# without 1P shadowing it back to empty.
_op_read_if_unset() {
  local var_name="$1" field="$2" current
  current="$(eval "printf '%s' \"\${$var_name-}\"")"
  if [[ -n "${current}" ]]; then
    return 0
  fi
  local fetched
  fetched="$(_op_read_auto "${ITEM}" "${field}")"
  if [[ -n "${fetched}" ]]; then
    eval "${var_name}=\"\${fetched}\""
  fi
}
_op_read_if_unset META_AD_ACCOUNT_ID "${FIELD_AD_ACCOUNT_ID}"
_op_read_if_unset META_APP_ID "${FIELD_APP_ID}"
_op_read_if_unset META_APP_SECRET "${FIELD_APP_SECRET}"
META_API_VERSION="$(_op_read_auto "${ITEM}" "META_API_VERSION")"
META_API_VERSION="${META_API_VERSION:-v21.0}"
META_GRAPH_BASE_URL="$(_op_read_auto "${ITEM}" "META_GRAPH_BASE_URL")"
META_GRAPH_BASE_URL="${META_GRAPH_BASE_URL:-https://graph.facebook.com}"

# Strip non-printable bytes from the token (defensive: 1Password fields pasted
# from web copy can carry stray newlines / Unicode zero-width characters).
META_ACCESS_TOKEN_RAW_LEN="${#META_ACCESS_TOKEN}"
META_ACCESS_TOKEN="$(printf '%s' "${META_ACCESS_TOKEN}" | LC_ALL=C tr -cd '!-~')"
if [[ "${META_ACCESS_TOKEN_RAW_LEN}" != "${#META_ACCESS_TOKEN}" ]]; then
  echo "[run-with-op] WARN: stripped $((META_ACCESS_TOKEN_RAW_LEN - ${#META_ACCESS_TOKEN})) non-printable byte(s) from token" >&2
fi
unset META_ACCESS_TOKEN_RAW_LEN

if [[ -z "${META_ACCESS_TOKEN}" ]]; then
  echo "[run-with-op] META_ACCESS_TOKEN empty in 1P item ${ITEM} (vault ${VAULT}, field ${FIELD_TOKEN})" >&2
  exit 1
fi

export META_ACCESS_TOKEN
export META_AD_ACCOUNT_ID
export META_APP_ID
export META_APP_SECRET
export META_API_VERSION
export META_GRAPH_BASE_URL

# Default to live mode when invoked through this wrapper. Caller can still
# force dry-run by exporting META_ADS_DRY_RUN=true before invoking.
: "${META_ADS_DRY_RUN:=false}"
export META_ADS_DRY_RUN

exec "$@"
