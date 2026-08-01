#!/usr/bin/env bash
# Resolves the Perplexity API key from 1Password and execs the inner command
# with it in env. Key bytes never appear in argv, in this script's stdout, or
# in any persistent file — they live only in the child process env.
# Mirrors tools/mcp/meta-ads/run-with-op.sh and tools/mcp/sheets/run-with-op.sh.
#
# Usage:
#   tools/ai-bridge/perplexity-api/run-with-op.sh node tools/ai-bridge/perplexity-api/query.js --prompt prompt.md --output out.json
#
# Item/vault/field selection (env-overridable):
#   PPLXOP_ITEM   1Password item name. Default: smos-perplexity-key.
#   PPLXOP_VAULT  1Password vault name. Default: Automation.
#   PPLXOP_FIELD  Field on the item containing the API key.
#                 Default: tries, in order: credential, password,
#                 "api key", PERPLEXITY_API_KEY.
#
# Auth: prefers the mythos-automation service account token (headless), with a
# desktop-session `op` fallback. Resolution order:
#   1. OP_SERVICE_ACCOUNT_TOKEN already in env (caller/launchd supplied)
#   2. macOS Keychain item smos-1p-automation-token (account Mythos)
#   3. Desktop-app session (interactive authorization prompt) — legacy fallback

set -euo pipefail

ITEM="${PPLXOP_ITEM:-smos-perplexity-key}"
VAULT="${PPLXOP_VAULT:-Automation}"

if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
  OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -a Mythos -s smos-1p-automation-token -w 2>/dev/null || true)"
fi

# Read a field: service-account read first (targets the Automation vault),
# then desktop-session read as fallback. Never prints key bytes.
_op_read_auto() {
  local item="$1" field="$2" out=""
  if [[ -n "${OP_SERVICE_ACCOUNT_TOKEN-}" ]]; then
    out="$(OP_SERVICE_ACCOUNT_TOKEN="${OP_SERVICE_ACCOUNT_TOKEN}" op read "op://${VAULT}/${item}/${field}" 2>/dev/null || true)"
  fi
  if [[ -z "${out}" ]]; then
    out="$(op read "op://${VAULT}/${item}/${field}" 2>/dev/null || true)"
  fi
  printf '%s' "${out}"
}

# Field fallback chain: explicit override first, then common label guesses.
PERPLEXITY_API_KEY=""
TRIED_FIELDS=()
if [[ -n "${PPLXOP_FIELD-}" ]]; then
  TRIED_FIELDS+=("${PPLXOP_FIELD}")
  PERPLEXITY_API_KEY="$(_op_read_auto "${ITEM}" "${PPLXOP_FIELD}")"
fi
if [[ -z "${PERPLEXITY_API_KEY}" ]]; then
  for f in credential password "api key" PERPLEXITY_API_KEY; do
    TRIED_FIELDS+=("${f}")
    PERPLEXITY_API_KEY="$(_op_read_auto "${ITEM}" "${f}")"
    [[ -n "${PERPLEXITY_API_KEY}" ]] && break
  done
fi

# Strip non-printable bytes (defensive: web-copied secrets can carry stray
# newlines / zero-width characters).
PERPLEXITY_API_KEY_RAW_LEN="${#PERPLEXITY_API_KEY}"
PERPLEXITY_API_KEY="$(printf '%s' "${PERPLEXITY_API_KEY}" | LC_ALL=C tr -cd '!-~')"
if [[ "${PERPLEXITY_API_KEY_RAW_LEN}" != "${#PERPLEXITY_API_KEY}" ]]; then
  echo "[run-with-op] WARN: stripped $((PERPLEXITY_API_KEY_RAW_LEN - ${#PERPLEXITY_API_KEY})) non-printable byte(s) from key" >&2
fi
unset PERPLEXITY_API_KEY_RAW_LEN

if [[ -z "${PERPLEXITY_API_KEY}" ]]; then
  joined="$(IFS=', '; echo "${TRIED_FIELDS[*]}")"
  echo "[run-with-op] Could not resolve a key from 1Password item '${ITEM}' (vault '${VAULT}')." >&2
  echo "[run-with-op] Tried fields: ${joined}" >&2
  echo "[run-with-op] Set PPLXOP_FIELD to the correct field label and retry." >&2
  exit 1
fi

export PERPLEXITY_API_KEY

trap 'unset PERPLEXITY_API_KEY' EXIT

exec "$@"
