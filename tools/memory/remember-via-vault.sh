#!/usr/bin/env bash
# remember-via-vault.sh — Write ONE memory file to Sam's AI-private vault.
#
# CANONICAL PATH: 1Password service-account token (machine identity, vault-scoped).
# DR FALLBACK:    tools/memory/remember-via-vault.dr.sh (master-password path).
#
# WHAT (this script — open-air, reviewable):
#   1. Accepts a single memory file path as $1.
#   2. Fetches Sam's service-account token from operator's vault item titled
#      "Service Account Auth Token: sam" (Employee vault, looked up BY TITLE,
#      NEVER by ID — operator may revoke+recreate; the title is durable).
#   3. Exports OP_SERVICE_ACCOUNT_TOKEN; op CLI authenticates directly with no
#      account add, no signin, no biometric, no master password.
#   4. Creates a single Secure Note in vault "Sam's Memories" whose body is the
#      memory file content (frontmatter description prepended to notesPlain).
#   5. Emits a single-entry URI manifest at
#      _dev/reports/memory/vault-bootstrap/<run-id>-remember.uris.json with
#      op://Sam%27s%20Memories/<id> URIs (URL-encoded vault name).
#
# HOW (runtime — local secrecy):
#   - Token held only in shell-local env var OP_SERVICE_ACCOUNT_TOKEN. EXIT/
#     INT/TERM/HUP trap unsets it on any exit path. Memory body fed to op via
#     stdin (JSON template), never via argv — `ps` cannot see it.
#   - Runs entirely on the operator's machine. No frontier API call sees
#     credential bytes. The output artifact is intentionally stripped of
#     secrets so the frontier can read it for index integration.
#
# Usage:
#   bash tools/memory/remember-via-vault.sh <memory-file-path> [--dry-run]
#
# Pre-req:
#   - op CLI 2.x signed into operator's personal account (used only to fetch
#     the service-account token from operator's Employee vault).
#   - jq, python3 installed.
#   - Operator vault item "Service Account Auth Token: sam" exists in Employee
#     vault with a `credential` field. If operator restructures Employee vault
#     name or item title, this script's token-fetch breaks — by design.
#
# Vault permissions are FROZEN at service-account creation. The token has
# Read+Write+Share on "Sam's Memories" only. If a new op operation needs a
# permission not in that scope, the entire service account must be revoked
# and recreated by the operator; this script cannot self-elevate.
#
# Exit codes: 0 ok, 1 precondition fail, 2 op CLI / token fail, 3 migration fail.

set -euo pipefail

MEMORY_FILE="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/_dev/reports/memory/vault-bootstrap"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT="$ARTIFACT_DIR/$RUN_ID-remember.log"
URI_OUTPUT="$ARTIFACT_DIR/$RUN_ID-remember.uris.json"

# Lookup BY TITLE (not by ID) — operator may revoke+recreate the token, which
# rotates the item ID. The title is durable; the ID is not.
SAM_TOKEN_ITEM_TITLE="Service Account Auth Token: sam"
SAM_TOKEN_OPERATOR_VAULT="Employee"
SAM_MEMORIES_VAULT="Sam's Memories"
# URL-encoded vault name for op:// URIs (apostrophe -> %27, space -> %20).
SAM_MEMORIES_VAULT_URI="Sam%27s%20Memories"

mkdir -p "$ARTIFACT_DIR"

# ─── Secret-cleanup trap ─────────────────────────────────────────────────────
cleanup_secrets() {
  unset OP_SERVICE_ACCOUNT_TOKEN 2>/dev/null || true
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

log "remember-via-vault run $RUN_ID (dry_run=$DRY_RUN, path=service-account)"

# ─── Argument validation ─────────────────────────────────────────────────────
[[ -n "$MEMORY_FILE" ]] || fail "usage: $0 <memory-file-path> [--dry-run]" 1
[[ -f "$MEMORY_FILE" ]] || fail "memory file not found: $MEMORY_FILE" 1

# ─── Pre-flight ──────────────────────────────────────────────────────────────
command -v op      >/dev/null || fail "op CLI not found" 1
command -v jq      >/dev/null || fail "jq not found" 1
command -v python3 >/dev/null || fail "python3 not found" 1

OP_VERSION="$(op --version)"
log "op version: $OP_VERSION"

# ─── Stage 1: fetch service-account token from operator vault ───────────────
# Lookup by title. Failure here means the operator's op CLI is not signed in,
# the Employee vault is unreachable, or the item title does not exist.
log "fetching service-account token from operator vault item: \"$SAM_TOKEN_ITEM_TITLE\""

if [[ $DRY_RUN -eq 1 ]]; then
  log "[dry-run] would resolve token: env OP_SERVICE_ACCOUNT_TOKEN → keychain smos-sam-automation-token/Mythos → op item get \"$SAM_TOKEN_ITEM_TITLE\""
  log "[dry-run] would: export OP_SERVICE_ACCOUNT_TOKEN=<redacted>"
else
  # Token resolution order (mirrors memory-vault.js#fetchSamServiceAccountToken):
  #   1. Pre-existing OP_SERVICE_ACCOUNT_TOKEN in the environment.
  #   2. macOS Keychain item smos-sam-automation-token / Mythos (headless, no
  #      signin) — durable cache mirroring the smos-1p-automation-token pattern.
  #   3. op item get "Service Account Auth Token: sam" (Employee vault) — the
  #      original personal-signin fallback, unchanged.
  # Token bytes live only in this shell's env, never in argv or logs.
  if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
    OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -a Mythos -s smos-sam-automation-token -w 2>/dev/null || true)"
    [[ -n "$OP_SERVICE_ACCOUNT_TOKEN" ]] && log "service-account token resolved from macOS Keychain (headless)"
  else
    log "service-account token supplied via environment"
  fi
  if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
    # Personal-signin fallback. python3 parses the JSON field-value envelope
    # returned by op (--format json wraps the credential in {"value": "..."}).
    OP_SERVICE_ACCOUNT_TOKEN="$(op item get "$SAM_TOKEN_ITEM_TITLE" \
        --vault "$SAM_TOKEN_OPERATOR_VAULT" \
        --reveal --fields credential --format json \
      | python3 -c "import json,sys;print(json.load(sys.stdin)['value'])" 2>&1)" \
      || fail "op item get \"$SAM_TOKEN_ITEM_TITLE\" failed (operator op CLI not signed in, item missing, or vault unreachable)" 2
    log "service-account token retrieved from operator vault (personal signin)"
  fi
  export OP_SERVICE_ACCOUNT_TOKEN
  [[ -n "$OP_SERVICE_ACCOUNT_TOKEN" ]] || fail "service-account token came back empty" 2
  log "service-account token ready (${#OP_SERVICE_ACCOUNT_TOKEN} chars, redacted)"
fi

# ─── Stage 2: vault-reachability probe ──────────────────────────────────────
# Confirms the token works AND that "Sam's Memories" is in scope. op whoami
# is NOT applicable for service-account-token-based calls; vault list is.
if [[ $DRY_RUN -eq 1 ]]; then
  log "[dry-run] would: op vault list --format=json | jq -e '.[] | select(.name==\"$SAM_MEMORIES_VAULT\")'"
else
  op vault list --format=json 2>/dev/null \
    | jq -e --arg n "$SAM_MEMORIES_VAULT" '.[] | select(.name==$n)' >/dev/null \
    || fail "vault \"$SAM_MEMORIES_VAULT\" not reachable via service-account token. DR fallback: bash tools/memory/remember-via-vault.dr.sh" 2
  log "vault \"$SAM_MEMORIES_VAULT\" reachable via service-account token"
fi

# ─── Stage 3: parse memory file frontmatter ─────────────────────────────────
filename="$(basename "$MEMORY_FILE")"

delim_count="$(grep -c '^---$' "$MEMORY_FILE" || true)"
[[ "$delim_count" -ge 2 ]] \
  || fail "frontmatter malformed in $filename (need >=2 '---' delimiters; found $delim_count)" 3

name="$(awk '/^---$/{n++;next} n==1 && /^name:[[:space:]]/{sub(/^name:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
description="$(awk '/^---$/{n++;next} n==1 && /^description:[[:space:]]/{sub(/^description:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
type_tag="$(awk '/^---$/{n++;next} n==1 && /^type:[[:space:]]/{sub(/^type:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
# Fallback: the harness memory linter normalizes frontmatter to nested metadata.type
# (stripping any top-level `type:`). Accept an indented `type:` under `metadata:` so a
# linter-normalized memory file remains durably writable without a manual workaround.
if [[ -z "$type_tag" ]]; then
  type_tag="$(awk '/^---$/{n++;next} n==1 && /^[[:space:]]+type:[[:space:]]/{sub(/^[[:space:]]*type:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
fi
body="$(awk '/^---$/{n++;next} n>=2{print}' "$MEMORY_FILE")"

[[ -n "$name"     ]] || fail "no name field in frontmatter of $filename" 3
[[ -n "$type_tag" ]] || fail "no type field in frontmatter of $filename" 3

notes_plain="$body"
[[ -n "$description" ]] && notes_plain=$'> '"$description"$'\n\n'"$body"

log "processing: $filename → secure note titled \"$name\" (tag: $type_tag)"

# ─── Stage 4: idempotency check (against Sam's Memories) ────────────────────
matched_ids=()
if [[ $DRY_RUN -eq 1 ]]; then
  log "  [dry-run] skipping idempotency lookup against real vault"
else
  candidates_json="$(op item list --vault "$SAM_MEMORIES_VAULT" \
                        --tags "$type_tag" --format=json 2>&1)" \
    || fail "op item list failed for $filename: $candidates_json" 3

  parsed_ids="$(printf '%s' "$candidates_json" | jq -r '.[].id' 2>&1)" \
    || fail "jq parse of op item list output failed for $filename: $parsed_ids" 3
  candidate_ids=()
  while IFS= read -r cid; do
    [[ -n "$cid" ]] && candidate_ids+=("$cid")
  done <<< "$parsed_ids"

  for cid in "${candidate_ids[@]+"${candidate_ids[@]}"}"; do
    cand_json="$(op item get "$cid" --vault "$SAM_MEMORIES_VAULT" --format=json 2>&1)" \
      || fail "op item get $cid failed during idempotency check: $cand_json" 3
    cval="$(printf '%s' "$cand_json" | jq -r --arg fname "$filename" '
              .fields[]? | select(.label=="sm_os_memory_file" and .value==$fname) | .value
            ' | head -1)"
    [[ -n "$cval" ]] && matched_ids+=("$cid")
  done

  if [[ "${#matched_ids[@]}" -gt 1 ]]; then
    fail "idempotency violation: $filename matches ${#matched_ids[@]} items in vault: ${matched_ids[*]}" 3
  fi
fi
existing_id="${matched_ids[0]:-}"

# ─── Stage 5: create or skip ─────────────────────────────────────────────────
if [[ -n "$existing_id" ]]; then
  log "  → already exists in vault (sm_os_memory_file match, id: $existing_id); skipping"
  item_id="$existing_id"
else
  if [[ $DRY_RUN -eq 1 ]]; then
    log "[dry-run] would: op item create --vault \"$SAM_MEMORIES_VAULT\" --category 'Secure Note' --title \"$name\" --tags \"$type_tag\" notesPlain=<via stdin template, ${#notes_plain} chars> sm_os_memory_file=\"$filename\""
    item_id="dryrun-$RANDOM"
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
        --vault "$SAM_MEMORIES_VAULT" \
        --format=json 2>&1)" || fail "op item create failed for $filename: $created" 3

    item_id="$(printf '%s' "$created" | jq -r '.id // empty')"
    [[ -n "$item_id" ]] || fail "op item create did not return an id for $filename" 3
    log "  → created (id: $item_id)"
  fi
fi

# ─── Stage 6: emit redacted URI manifest ────────────────────────────────────
URI_ENTRIES_JSON="$(jq -n \
  --arg file "$filename" \
  --arg name "$name" \
  --arg type "$type_tag" \
  --arg item_uri  "op://${SAM_MEMORIES_VAULT_URI}/$item_id" \
  --arg notes_uri "op://${SAM_MEMORIES_VAULT_URI}/$item_id/notesPlain" \
  '[{
    file: $file,
    name: $name,
    type: $type,
    item_uri: $item_uri,
    notes_uri: $notes_uri
  }]')"

printf '%s\n' "$URI_ENTRIES_JSON" | jq . > "$URI_OUTPUT"
log "wrote URI manifest: $URI_OUTPUT"
log "remember-via-vault complete (run $RUN_ID, dry_run=$DRY_RUN, file=$filename)"

# Trap will clear OP_SERVICE_ACCOUNT_TOKEN on exit.
