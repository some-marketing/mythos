#!/usr/bin/env bash
# Fetches CRM (Moxie) credentials from 1Password and execs the inner command
# with them in env. Credential bytes never appear in argv, in this script's
# stdout, or in any persistent file — they live only in the child process env.
#
# Usage:
#   tools/mcp/crm/run-with-op.sh node tools/mcp/crm/some-read-script.js
#
# SCAFFOLD STATUS: the 1Password item name/vault below
# (`mythos-moxie-api-credentials` / `Automation`) is a documented default —
# adjust to your own item name. The exact
# FIELD LABEL(S) on that item (api key field name, and whether the
# per-workspace base URL lives on a separate field or is embedded in a URL
# field) are UNCONFIRMED. Two attempts to read the item's field values were
# correctly denied to the planning/build session by the credential-
# materialization classifier — only the operator's own direct, in-the-moment
# `op item get` can resolve the real field labels. The defaults below
# (MOXIE_API_KEY / MOXIE_BASE_URL) are this script's best-guess field names;
# override via CRMOP_FIELD_API_KEY / CRMOP_FIELD_BASE_URL if the operator
# confirms different labels at build time. Nothing in this script reads or
# prints field values — it only ever resolves a value into the child env.
#
# Item/vault/field selection (env-overridable):
#   CRMOP_ITEM              1Password item name. Default: mythos-moxie-api-credentials.
#   CRMOP_VAULT              1Password vault name (desktop-session fallback). Default: Automation.
#   CRMOP_FIELD_API_KEY      Field on the item containing the Moxie API key.
#                            Default: MOXIE_API_KEY. Falls back to "credential"
#                            if MOXIE_API_KEY isn't a field on the item.
#   CRMOP_FIELD_BASE_URL     Field on the item containing the per-workspace
#                            base URL. Default: MOXIE_BASE_URL.
#
# Honours:
#   CRM_DRY_RUN (default when invoked via this wrapper: false — see below;
#   caller can still force dry-run by exporting CRM_DRY_RUN=true)
#
# Auth: requires `op` (1Password CLI) signed in, OR the mythos-automation
# service-account token in macOS Keychain (headless path, mirrors meta-ads).

set -euo pipefail

ITEM="${CRMOP_ITEM:-mythos-moxie-api-credentials}"
VAULT="${CRMOP_VAULT:-Automation}"

# --- Headless auth: prefer the mythos-automation service account ---
# Resolution order:
#   1. OP_SERVICE_ACCOUNT_TOKEN already in env (caller/launchd supplied)
#   2. macOS Keychain item mythos-1p-automation-token (account mythos)
#   3. Desktop-app session (interactive authorization prompt) — legacy fallback
# The service account can only see the "Automation" vault, so SA reads target
# that vault first; the configured ${VAULT} is the desktop-session fallback.
SA_VAULT="${CRMOP_SA_VAULT:-Automation}"
if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
  OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -a mythos -s mythos-1p-automation-token -w 2>/dev/null || true)"
fi

# Read a field: service-account read from the Automation vault first, then
# desktop-session read from the configured vault. Never prints field bytes.
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

FIELD_API_KEY="${CRMOP_FIELD_API_KEY:-MOXIE_API_KEY}"
FIELD_BASE_URL="${CRMOP_FIELD_BASE_URL:-MOXIE_BASE_URL}"

MOXIE_API_KEY="$(_op_read_auto "${ITEM}" "${FIELD_API_KEY}")"
# Fall back to "credential" if the api-key field doesn't exist on the item
# under the expected label.
if [[ -z "${MOXIE_API_KEY}" && "${FIELD_API_KEY}" == "MOXIE_API_KEY" ]]; then
  MOXIE_API_KEY="$(_op_read_auto "${ITEM}" "credential")"
fi

MOXIE_BASE_URL="$(_op_read_auto "${ITEM}" "${FIELD_BASE_URL}")"
# Confirmed 2026-07-08 (operator-present build-time read, labels only): the
# item is an API_CREDENTIAL whose key lives in "credential" and whose
# per-workspace base URL lives in the field labeled "base url" (id hostname).
if [[ -z "${MOXIE_BASE_URL}" && "${FIELD_BASE_URL}" == "MOXIE_BASE_URL" ]]; then
  MOXIE_BASE_URL="$(_op_read_auto "${ITEM}" "base url")"
fi
if [[ -z "${MOXIE_BASE_URL}" && "${FIELD_BASE_URL}" == "MOXIE_BASE_URL" ]]; then
  MOXIE_BASE_URL="$(_op_read_auto "${ITEM}" "hostname")"
fi

# Strip non-printable bytes from the key (defensive: 1Password fields pasted
# from web copy can carry stray newlines / Unicode zero-width characters).
MOXIE_API_KEY_RAW_LEN="${#MOXIE_API_KEY}"
MOXIE_API_KEY="$(printf '%s' "${MOXIE_API_KEY}" | LC_ALL=C tr -cd '!-~')"
if [[ "${MOXIE_API_KEY_RAW_LEN}" != "${#MOXIE_API_KEY}" ]]; then
  echo "[run-with-op] WARN: stripped $((MOXIE_API_KEY_RAW_LEN - ${#MOXIE_API_KEY})) non-printable byte(s) from key" >&2
fi
unset MOXIE_API_KEY_RAW_LEN

if [[ -z "${MOXIE_API_KEY}" ]]; then
  echo "[run-with-op] MOXIE_API_KEY empty in 1P item ${ITEM} (vault ${VAULT}, field ${FIELD_API_KEY}). Field label may be unconfirmed — see header comment." >&2
  exit 1
fi

# Strip whitespace/non-printables from the base URL too (the live field was
# observed 2026-07-08 to carry a leading space, which breaks URL parsing).
MOXIE_BASE_URL="$(printf '%s' "${MOXIE_BASE_URL}" | LC_ALL=C tr -cd '!-~')"

if [[ -z "${MOXIE_BASE_URL}" ]]; then
  echo "[run-with-op] MOXIE_BASE_URL empty in 1P item ${ITEM} (vault ${VAULT}, field ${FIELD_BASE_URL}). Base URL is per-workspace — field label may be unconfirmed, see header comment." >&2
  exit 1
fi

export MOXIE_API_KEY
export MOXIE_BASE_URL

# This wrapper resolves real credentials, so default to live mode when
# invoked through it — same posture as meta-ads/run-with-op.sh. Caller can
# still force dry-run by exporting CRM_DRY_RUN=true before invoking. As of
# this scaffold (2026-07-01) no live call path is implemented (read-lane and
# live-read-probe are separate, operator-gated steps), so this default has no
# effect until that code exists.
: "${CRM_DRY_RUN:=false}"
export CRM_DRY_RUN

exec "$@"
