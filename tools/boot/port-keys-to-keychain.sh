#!/usr/bin/env bash
# port-keys-to-keychain.sh — one-time port of /tt's credential set into the
# macOS login Keychain under CANONICAL env-var-shaped service names, so
# unattended cycles never trigger 1Password desktop auth (the operator's
# "clicking my wrist" problem).
#
# SAFETY INVARIANT (matches tools/memory/remember-via-vault.sh's posture):
# credential VALUES never leave this process — they are never echoed, never
# logged, never returned to a calling agent. Only names, lengths, and
# success/failure are reported.
#
# Sources, in order per key:
#   1. an existing Keychain entry under a legacy/variant service name
#   2. 1Password via the service-account token already in the Keychain
#      (item: smos-1p-automation-token, account: Mythos) — headless, no prompt
#
# Usage: bash tools/boot/port-keys-to-keychain.sh [--dry-run]
set -uo pipefail

ACCOUNT="mythos"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

echo "=== /tt credential port -> macOS Keychain (account: $ACCOUNT) ==="
[[ $DRY_RUN -eq 1 ]] && echo "(dry run: nothing will be written)"
echo ""

# Resolve the 1Password service-account token from the Keychain (headless path).
# Account is sm_os, not Mythos — the repo's own wrappers had this wrong, which is
# precisely why 1Password reads fell through to desktop auth (operator prompts).
OP_TOKEN="$(security find-generic-password -a sm_os -s smos-1p-automation-token -w 2>/dev/null || true)"
if [[ -z "$OP_TOKEN" ]]; then
  OP_TOKEN="$(security find-generic-password -s smos-1p-automation-token -w 2>/dev/null || true)"
fi
if [[ -n "$OP_TOKEN" ]]; then
  echo "[op] service-account token resolved from Keychain (headless path available)"
else
  echo "[op] WARNING: no service-account token in Keychain; 1Password reads may prompt"
fi
echo ""

store() {  # store <canonical-service> <value>
  local svc="$1" val="$2"
  if [[ -z "$val" ]]; then return 1; fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would store $svc (${#val} chars)"
    return 0
  fi
  security add-generic-password -U -a "$ACCOUNT" -s "$svc" -w "$val" 2>/dev/null
}

from_keychain() {  # from_keychain <legacy-service> [legacy-account]
  local svc="$1" acct="${2:-}"
  if [[ -n "$acct" ]]; then
    security find-generic-password -a "$acct" -s "$svc" -w 2>/dev/null || true
  else
    security find-generic-password -s "$svc" -w 2>/dev/null || true
  fi
}

from_op() {  # from_op <op-uri>
  local ref="$1"
  if [[ -n "$OP_TOKEN" ]]; then
    OP_SERVICE_ACCOUNT_TOKEN="$OP_TOKEN" op read "$ref" 2>/dev/null || true
  else
    op read "$ref" 2>/dev/null || true
  fi
}

port() {  # port <canonical> <legacy-keychain-service-or-empty> <op-uri-or-empty>
  local canon="$1" legacy="$2" opref="$3" val="" src=""

  # Already canonical? Leave it alone.
  if security find-generic-password -a "$ACCOUNT" -s "$canon" -w >/dev/null 2>&1; then
    echo "[$canon] already present under the canonical name — skipped"
    return 0
  fi

  if [[ -n "$legacy" ]]; then
    val="$(from_keychain "$legacy")"
    [[ -n "$val" ]] && src="keychain:$legacy"
  fi
  if [[ -z "$val" && -n "$opref" ]]; then
    val="$(from_op "$opref")"
    [[ -n "$val" ]] && src="1password"
  fi

  if [[ -z "$val" ]]; then
    echo "[$canon] NOT FOUND in any source (legacy='${legacy:-none}' op='${opref:-none}') — operator action needed"
    return 1
  fi

  if store "$canon" "$val"; then
    echo "[$canon] stored from $src (${#val} chars)"
  else
    echo "[$canon] STORE FAILED (source was $src)"
    return 1
  fi
  val=""
}

# canonical                legacy keychain service     1Password reference
#
# NOTE ON VAULT SCOPE: the service account can only see the "Automation" vault.
# Items living in "Employee" (ElevenLabs, the Dart token) cannot be read with the
# service-account token, so those rely on the legacy Keychain entry. Where the
# legacy entry exists this is fine — and porting it under the canonical name is
# precisely what removes the need for `op` at all.

# --- AI / bridge lanes (the hot path for unattended runs) ---
port "OPENROUTER_API_KEY"  "openrouter-api-key"        "op://Automation/Open Router API/credential"
port "GEMINI_API_KEY"      "gemini-api-key"            "op://Automation/sm_os-gemini-credential/credential"
port "PERPLEXITY_API_KEY"  ""                          "op://Automation/smos-perplexity-key/credential"

# --- messaging / voice ---
port "DISCORD_BOT_TOKEN"   "sm-os-discord-bot-token"   "op://Automation/DISCORD_BOT_TOKEN/credential"
port "ELEVENLABS_API_KEY"  "ELEVENLABS_API_KEY"        ""

# --- project management ---
port "DART_TOKEN"          "DART_TOKEN"                ""

# --- telemetry (Langfuse export lane) ---
port "LANGFUSE_PUBLIC_KEY" ""                          "op://Automation/smos-langfuse-api/Public Key"
port "LANGFUSE_SECRET_KEY" ""                          "op://Automation/smos-langfuse-api/credential"

# --- Google Ads (also present in .env.local; Keychain is the headless source) ---
port "GOOGLE_ADS_CLIENT_ID"        "GOOGLE_ADS_CLIENT_ID"        ""
port "GOOGLE_ADS_CLIENT_SECRET"    "GOOGLE_ADS_CLIENT_SECRET"    ""
port "GOOGLE_ADS_DEVELOPER_TOKEN"  "GOOGLE_ADS_DEVELOPER_TOKEN"  ""
port "GOOGLE_ADS_REFRESH_TOKEN"    "GOOGLE_ADS_REFRESH_TOKEN"    ""
port "GOOGLE_ADS_CUSTOMER_ID"      "GOOGLE_ADS_CUSTOMER_ID"      ""
port "GOOGLE_ADS_LOGIN_CUSTOMER_ID" "GOOGLE_ADS_LOGIN_CUSTOMER_ID" ""

# --- Google OAuth (sheets lane; canonical SHEETS_* names) ---
port "SHEETS_CLIENT_ID"     "sm-os-google-oauth-client-client-id"     "op://Automation/sm-os-google-oauth-client/client id"
port "SHEETS_CLIENT_SECRET" "sm-os-google-oauth-client-client-secret" "op://Automation/sm-os-google-oauth-client/client secret"
port "SHEETS_REFRESH_TOKEN" "sm-os-google-oauth-client-refresh-token" "op://Automation/sm-os-google-oauth-client/refresh token"

echo ""
echo "=== verification (presence only; values never read back into output) ==="
for svc in OPENROUTER_API_KEY GEMINI_API_KEY PERPLEXITY_API_KEY \
           DISCORD_BOT_TOKEN ELEVENLABS_API_KEY DART_TOKEN \
           LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY \
           GOOGLE_ADS_CLIENT_ID GOOGLE_ADS_CLIENT_SECRET GOOGLE_ADS_DEVELOPER_TOKEN \
           GOOGLE_ADS_REFRESH_TOKEN GOOGLE_ADS_CUSTOMER_ID GOOGLE_ADS_LOGIN_CUSTOMER_ID \
           SHEETS_CLIENT_ID SHEETS_CLIENT_SECRET SHEETS_REFRESH_TOKEN; do
  if security find-generic-password -a "$ACCOUNT" -s "$svc" >/dev/null 2>&1; then
    echo "  OK      $svc"
  else
    echo "  MISSING $svc"
  fi
done
OP_TOKEN=""
echo ""
echo "Retrieval pattern for tools:"
echo "  security find-generic-password -a $ACCOUNT -s <SERVICE> -w"
