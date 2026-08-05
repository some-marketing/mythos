#!/usr/bin/env bash
# resolve-secret.sh — bash-sourceable twin of resolve-secret.cjs.
#
# This file deliberately contains NO resolution policy of its own. It shells to
# resolve-secret.cjs so there is exactly ONE ordering, one set of 1Password
# service-account token locations, and one place to change them. A second
# implementation would drift, and drift in credential resolution is what caused
# the operator's desktop-auth prompts in the first place.
#
# SAFETY INVARIANT (matches tools/memory/remember-via-vault.sh): credential
# VALUES are never echoed, never logged, never placed in argv. They are assigned
# to a shell variable in the caller's process and nothing else. The one-line
# diagnostic on stderr names the TIER and the LENGTH, never the value.
#
# USAGE
#   source "$(dirname "${BASH_SOURCE[0]}")/../credentials/resolve-secret.sh"
#
#   # Assign into a named variable (preferred — value never hits stdout):
#   resolve_secret_into MY_VAR OPENROUTER_API_KEY \
#     --op-ref 'op://Automation/Open Router API/credential' \
#     --legacy openrouter-api-key
#
#   # Export the canonical env var directly (most common in run-with-op wrappers):
#   resolve_secret_export OPENROUTER_API_KEY \
#     --op-ref 'op://Automation/Open Router API/credential' \
#     --legacy openrouter-api-key
#
#   # Presence check, no value read:
#   if resolve_secret_present DISCORD_BOT_TOKEN; then ...; fi
#
# Every function returns non-zero on failure and prints a descriptive reason to
# stderr, so `set -e` callers fail fast rather than proceeding with an empty
# credential.

_RESOLVE_SECRET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_RESOLVE_SECRET_CJS="${_RESOLVE_SECRET_DIR}/resolve-secret.cjs"

# resolve_secret_into <VARNAME> <SECRET_NAME> [--op-ref REF] [--legacy SVC]... [--account ACCT] [--optional]
resolve_secret_into() {
  local __varname="$1"; shift
  local __name="$1"; shift
  local __value
  # Command substitution captures the child's stdout into a shell variable in
  # this process. The value is never printed and never enters argv.
  if ! __value="$(node "${_RESOLVE_SECRET_CJS}" "${__name}" "$@")"; then
    return 1
  fi
  if [[ -z "${__value}" ]]; then
    return 1
  fi
  printf -v "${__varname}" '%s' "${__value}"
  __value=""
  return 0
}

# resolve_secret_export <SECRET_NAME> [flags...]
# Resolves and exports the canonical name into the environment for a child.
resolve_secret_export() {
  local __name="$1"; shift
  # Already exported and non-empty? Tier 1 would return it anyway; short-circuit
  # so we do not spawn node for nothing.
  if [[ -n "${!__name:-}" ]]; then
    echo "[resolve-secret] ${__name}: resolved via tier 1 (env, pre-set)" >&2
    return 0
  fi
  if ! resolve_secret_into "${__name}" "${__name}" "$@"; then
    return 1
  fi
  export "${__name}"
  return 0
}

# resolve_secret_tier <SECRET_NAME> [flags...]
# Prints ONLY the tier name (env|keychain|keychain-legacy|onepassword) on
# stdout. Safe to log — no value can be emitted. Used by the preflight check.
resolve_secret_tier() {
  local __name="$1"; shift
  node "${_RESOLVE_SECRET_CJS}" "${__name}" "$@" --tier-only
}

# ensure_op_service_account_token
# Exports OP_SERVICE_ACCOUNT_TOKEN (from the Keychain) so that every subsequent
# `op` call in this shell runs HEADLESS. This is the single most important line
# for unattended runs: `op` gives OP_SERVICE_ACCOUNT_TOKEN precedence over
# desktop integration, so with it set `op` can no longer pop a macOS auth
# dialog and stall the run. Without it, a bare `op read` WILL prompt.
#
# Also pins OP_BIOMETRIC_UNLOCK_ENABLED=false as a belt-and-braces guard.
# Returns non-zero (and explains on stderr) if no token exists, so callers can
# decide whether to degrade or fail fast. Never prints the token.
ensure_op_service_account_token() {
  if [[ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
    export OP_BIOMETRIC_UNLOCK_ENABLED=false
    return 0
  fi
  local __tok
  if ! __tok="$(node "${_RESOLVE_SECRET_CJS}" --op-service-account-token)"; then
    return 1
  fi
  [[ -z "${__tok}" ]] && return 1
  export OP_SERVICE_ACCOUNT_TOKEN="${__tok}"
  export OP_BIOMETRIC_UNLOCK_ENABLED=false
  __tok=""
  return 0
}

# resolve_secret_present <SECRET_NAME> [account]
# Presence only — never passes -w, so no value can be returned.
resolve_secret_present() {
  local __name="$1" __acct="${2:-mythos}"
  [[ -n "${!__name:-}" ]] && return 0
  security find-generic-password -a "${__acct}" -s "${__name}" >/dev/null 2>&1
}
