#!/usr/bin/env bash
# remember-via-vault.dr.sh — DISASTER-RECOVERY fallback for /remember.
#
# This is the PARKED master-password path. It is NOT the canonical surface.
# Canonical: tools/memory/remember-via-vault.sh (service-account token).
#
# ACTIVATION CRITERIA — use ONLY when:
#   - The service-account token "Service Account Auth Token: sam" has been
#     revoked AND no replacement token has been issued, AND
#   - A memory write must land before the operator can issue a new token.
#
# This path:
#   - Reads master password + secret key from operator's vault item
#     "Sam's 1Password" (Employee vault, op item ID hardcoded below — will
#     drift if operator restructures).
#   - Registers Sam's account with the local op CLI (idempotent).
#   - Performs interactive op signin (master password held shell-local only).
#   - Writes to Sam's "Employee" vault on Sam's account (NOT to "Sam's
#     Memories" — that vault belongs to the service-account scope).
#
# Usage:
#   bash tools/memory/remember-via-vault.dr.sh <memory-file-path> [--dry-run]
#
# Pre-req: op CLI 2.x signed into operator's personal account. jq installed.
#
# Exit codes: 0 ok, 1 precondition fail, 2 op CLI fail, 3 migration fail.

set -euo pipefail

MEMORY_FILE="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/_dev/reports/memory/vault-bootstrap"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT="$ARTIFACT_DIR/$RUN_ID-remember-dr.log"
URI_OUTPUT="$ARTIFACT_DIR/$RUN_ID-remember-dr.uris.json"

# op item ID for "Sam's 1Password" in operator's Employee vault.
SAM_CREDENTIAL_ITEM_ID="6pr5m6weef3om77zxpfh5oyfum"
SAM_ACCOUNT_SHORTHAND="somemarketing"

mkdir -p "$ARTIFACT_DIR"

cleanup_secrets() {
  unset CRED_JSON SAM_SECRET_KEY SAM_OP_PASSWORD SAM_SESSION_TOKEN \
        OP_SESSION_somemarketing 2>/dev/null || true
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

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$ARTIFACT"; }
fail() { log "FAIL: $*"; exit "${2:-1}"; }

log "remember-via-vault.dr.sh run $RUN_ID (dry_run=$DRY_RUN, path=master-password DR)"
log "WARNING: this is the parked DR path. Canonical path is remember-via-vault.sh (service-account)."

[[ -n "$MEMORY_FILE" ]] || fail "usage: $0 <memory-file-path> [--dry-run]" 1
[[ -f "$MEMORY_FILE" ]] || fail "memory file not found: $MEMORY_FILE" 1

command -v op  >/dev/null || fail "op CLI not found" 1
command -v jq  >/dev/null || fail "jq not found" 1

OP_VERSION="$(op --version)"
log "op version: $OP_VERSION"

# Dry-run describes the parked DR path without requiring an active operator
# session — purpose is descriptive verification, not auth.
if [[ $DRY_RUN -eq 1 ]]; then
  log "[dry-run] would: op whoami (operator account precondition)"
  log "[dry-run] would: op item get $SAM_CREDENTIAL_ITEM_ID --format=json"
  log "[dry-run] would: register Sam's account, op signin, write to Sam's Employee vault"
  log "[dry-run] DR-fallback path described; no real op operations performed"
  log "remember-via-vault.dr.sh dry-run complete"
  exit 0
fi

op whoami --format=json >/dev/null 2>&1 \
  || fail "op CLI not signed in to operator account; run \`op signin\` first" 1

# ─── Stage 1: fetch Sam's credentials from operator's vault ─────────────────
log "fetching credential record from operator vault (item: $SAM_CREDENTIAL_ITEM_ID)"

CRED_JSON="$(op item get "$SAM_CREDENTIAL_ITEM_ID" --format=json 2>&1)" \
  || fail "op item get failed" 2

SAM_SIGNIN_URL="$(printf '%s' "$CRED_JSON" | jq -r '
  (.urls[0].href // (.fields[]? | select(.label=="sign-in address" or .label=="website") | .value)) // empty
' | head -1)"
SAM_EMAIL="$(printf '%s' "$CRED_JSON" | jq -r '.fields[]? | select(.label=="email" or .label=="username") | .value' | head -1)"
SAM_SECRET_KEY="$(printf '%s' "$CRED_JSON" | jq -r '.fields[]? | select(.label=="secret key" or .label=="Secret Key") | .value' | head -1)"
SAM_OP_PASSWORD="$(printf '%s' "$CRED_JSON" | jq -r '.fields[]? | select(.label=="password") | .value' | head -1)"
unset CRED_JSON

[[ -n "$SAM_SIGNIN_URL"  ]] || fail "could not extract sign-in URL from credential item" 2
[[ -n "$SAM_EMAIL"       ]] || fail "could not extract email from credential item" 2
[[ -n "$SAM_SECRET_KEY"  ]] || fail "could not extract secret key from credential item" 2
[[ -n "$SAM_OP_PASSWORD" ]] || fail "could not extract master password from credential item" 2

log "credentials extracted (sign-in: $SAM_SIGNIN_URL, email: $SAM_EMAIL, secret-key: ${#SAM_SECRET_KEY} chars, password: <redacted ${#SAM_OP_PASSWORD} chars>)"

# ─── Stage 2: register Sam's account with op CLI (idempotent) ───────────────
if op account list --format=json | jq -e --arg url "$SAM_SIGNIN_URL" '.[] | select(.url==$url)' >/dev/null 2>&1; then
  log "Sam's account already registered with op CLI"
else
  log "registering Sam's account with op CLI"
  printf '%s' "$SAM_OP_PASSWORD" | op account add \
    --address "$SAM_SIGNIN_URL" \
    --email "$SAM_EMAIL" \
    --secret-key "$SAM_SECRET_KEY" \
    --shorthand "$SAM_ACCOUNT_SHORTHAND" \
    --signin >/dev/null 2>&1 || fail "op account add failed" 2
fi
unset SAM_SECRET_KEY

# ─── Stage 3: sign in to Sam's account ──────────────────────────────────────
log "signing in to Sam's account"
SAM_SESSION_TOKEN="$(printf '%s' "$SAM_OP_PASSWORD" | op signin --account "$SAM_ACCOUNT_SHORTHAND" --raw 2>&1)" \
  || fail "op signin failed" 2
unset SAM_OP_PASSWORD
export OP_SESSION_somemarketing="$SAM_SESSION_TOKEN"
unset SAM_SESSION_TOKEN

# ─── Stage 4: confirm Employee vault is accessible ──────────────────────────
op vault list --account "$SAM_ACCOUNT_SHORTHAND" --format=json \
  | jq -e '.[] | select(.name=="Employee")' >/dev/null \
  || fail "Sam's Employee vault not visible after signin" 2
log "Sam's Employee vault confirmed accessible"

# ─── Stage 5: parse memory file frontmatter ─────────────────────────────────
filename="$(basename "$MEMORY_FILE")"

delim_count="$(grep -c '^---$' "$MEMORY_FILE" || true)"
[[ "$delim_count" -ge 2 ]] \
  || fail "frontmatter malformed in $filename (need >=2 '---' delimiters; found $delim_count)" 3

name="$(awk '/^---$/{n++;next} n==1 && /^name:[[:space:]]/{sub(/^name:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
description="$(awk '/^---$/{n++;next} n==1 && /^description:[[:space:]]/{sub(/^description:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
type_tag="$(awk '/^---$/{n++;next} n==1 && /^type:[[:space:]]/{sub(/^type:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
body="$(awk '/^---$/{n++;next} n>=2{print}' "$MEMORY_FILE")"

[[ -n "$name"     ]] || fail "no name field in frontmatter of $filename" 3
[[ -n "$type_tag" ]] || fail "no type field in frontmatter of $filename" 3

notes_plain="$body"
[[ -n "$description" ]] && notes_plain=$'> '"$description"$'\n\n'"$body"

log "processing: $filename → secure note titled \"$name\" (tag: $type_tag)"

# ─── Stage 6: idempotency check ─────────────────────────────────────────────
matched_ids=()
candidates_json="$(op item list --vault Employee --account "$SAM_ACCOUNT_SHORTHAND" \
                      --tags "$type_tag" --format=json 2>&1)" \
  || fail "op item list failed for $filename: $candidates_json" 3

parsed_ids="$(printf '%s' "$candidates_json" | jq -r '.[].id' 2>&1)" \
  || fail "jq parse of op item list output failed for $filename: $parsed_ids" 3
candidate_ids=()
while IFS= read -r cid; do
  [[ -n "$cid" ]] && candidate_ids+=("$cid")
done <<< "$parsed_ids"

for cid in "${candidate_ids[@]+"${candidate_ids[@]}"}"; do
  cand_json="$(op item get "$cid" --account "$SAM_ACCOUNT_SHORTHAND" --format=json 2>&1)" \
    || fail "op item get $cid failed during idempotency check: $cand_json" 3
  cval="$(printf '%s' "$cand_json" | jq -r --arg fname "$filename" '
            .fields[]? | select(.label=="sm_os_memory_file" and .value==$fname) | .value
          ' | head -1)"
  [[ -n "$cval" ]] && matched_ids+=("$cid")
done

if [[ "${#matched_ids[@]}" -gt 1 ]]; then
  fail "idempotency violation: $filename matches ${#matched_ids[@]} items in vault: ${matched_ids[*]}" 3
fi
existing_id="${matched_ids[0]:-}"

# ─── Stage 7: create or skip ─────────────────────────────────────────────────
if [[ -n "$existing_id" ]]; then
  log "  → already exists in vault (sm_os_memory_file match, id: $existing_id); skipping"
  item_id="$existing_id"
else
  template_json="$(jq -n \
    --arg title "$name" \
    --arg tag "$type_tag" \
    --arg notes "$notes_plain" \
    --arg fname "$filename" \
    '{
      title: $title,
      category: "SECURE_NOTE",
      tags: [$tag],
      fields: [
        {
          id: "notesPlain",
          type: "STRING",
          purpose: "NOTES",
          label: "notesPlain",
          value: $notes
        },
        {
          id: "sm_os_memory_file",
          type: "STRING",
          label: "sm_os_memory_file",
          value: $fname
        }
      ]
    }')"

  created="$(printf '%s' "$template_json" | op item create - \
      --account "$SAM_ACCOUNT_SHORTHAND" \
      --vault "Employee" \
      --format=json 2>&1)" || fail "op item create failed for $filename: $created" 3

  item_id="$(printf '%s' "$created" | jq -r '.id // empty')"
  [[ -n "$item_id" ]] || fail "op item create did not return an id for $filename" 3
  log "  → created (id: $item_id)"
fi

# ─── Stage 8: emit redacted URI manifest ────────────────────────────────────
URI_ENTRIES_JSON="$(jq -n \
  --arg file "$filename" \
  --arg name "$name" \
  --arg type "$type_tag" \
  --arg item_uri "op://Employee/$item_id" \
  --arg notes_uri "op://Employee/$item_id/notesPlain" \
  '[{
    file: $file,
    name: $name,
    type: $type,
    item_uri: $item_uri,
    notes_uri: $notes_uri
  }]')"

printf '%s\n' "$URI_ENTRIES_JSON" | jq . > "$URI_OUTPUT"
log "wrote URI manifest: $URI_OUTPUT"
log "remember-via-vault.dr.sh complete (run $RUN_ID, dry_run=$DRY_RUN, file=$filename)"
