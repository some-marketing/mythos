#!/usr/bin/env bash
# tools/credentials/setup-google-oauth-creds.sh
#
# Auto-pick the Mythos Google OAuth *client* JSON from a secrets directory and
# store its client_id + client_secret into macOS Keychain AND a 1Password item
# (matching the existing youtube convention: fields "client id" / "client secret"
# / "refresh token"). Secrets are read ON-DEVICE, never printed, never written to
# shell history. The file path — not the secret — is what appears in node's argv.
#
# Picking logic: among *.json in --dir, keep those whose project_id == --project;
# if `op` can read an existing YouTube OAuth item, skip the client_id it already
# uses (so Sheets gets its own OAuth client); otherwise pick the first by name.
# Override with --file to force a specific one.
#
# Usage:
#   tools/credentials/setup-google-oauth-creds.sh [options]
# Options:
#   --dir DIR        secrets dir         (default: "$HOME/Downloads/Client Secrets")
#   --project PROJ   GCP project to match (or MYTHOS_GOOGLE_OAUTH_PROJECT)
#   --file PATH      force a specific file (skips auto-pick)
#   --name NAME      Keychain prefix     (default: mythos-google-oauth-client)
#   --op-item ITEM   1Password title     (default: mythos-google-oauth-client)
#   --vault VAULT    1Password vault     (default: Automation)
#   --keychain-only  store only in Keychain
#   --op-only        store only in 1Password
#   --dry-run        show the pick (no secret) and exit; store nothing
#
# Retrieve later:
#   security find-generic-password -a Mythos -s <name>-client-secret -w
#   op read "op://<vault>/<op-item>/client secret"
#
# NOTE (single-user Mac): `security -w "$V"` and `op item ... "field=$V"` briefly
# expose the value in that process's argv (same-user `ps`). Acceptable on a
# single-user machine; the value never hits history, a file, or this script's output.

set -euo pipefail

DIR="${MYTHOS_CLIENT_SECRETS_DIR:-$HOME/Downloads/Client Secrets}"
PROJECT="${MYTHOS_GOOGLE_OAUTH_PROJECT:-}"
FILE=""
NAME="mythos-google-oauth-client"
OP_ITEM="mythos-google-oauth-client"
VAULT="Automation"
ACCOUNT="mythos"
DO_KEYCHAIN=1
DO_OP=1
DRY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --file) FILE="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --op-item) OP_ITEM="$2"; shift 2;;
    --vault) VAULT="$2"; shift 2;;
    --keychain-only) DO_OP=0; shift;;
    --op-only) DO_KEYCHAIN=0; shift;;
    --dry-run) DRY=1; shift;;
    -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH" >&2; exit 1; }
if [[ -z "$FILE" && -z "$PROJECT" ]]; then
  echo "ERROR: --project or MYTHOS_GOOGLE_OAUTH_PROJECT is required when --file is not supplied" >&2
  exit 1
fi

# Read a single non-secret-or-secret field on-device (file path in argv, not the value).
field() {
  node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const o=c.installed||c.web||{};process.stdout.write((o[process.argv[2]]||""))' "$1" "$2"
}

# ---- pick the file ----
YT_ID=""
if [[ -z "$FILE" ]]; then
  [[ -d "$DIR" ]] || { echo "ERROR: dir not found: $DIR" >&2; exit 1; }

  CANDIDATES=()
  while IFS= read -r -d '' f; do
    pid="$(field "$f" project_id || true)"
    [[ "$pid" == "$PROJECT" ]] && CANDIDATES+=("$f")
  done < <(find "$DIR" -maxdepth 1 -type f -name '*.json' -print0)

  [[ ${#CANDIDATES[@]} -gt 0 ]] || { echo "ERROR: no OAuth client for project '$PROJECT' in: $DIR" >&2; exit 1; }

  # sort candidates by path (bash-3.2 safe; filenames carry no newlines)
  SORTED=()
  while IFS= read -r line; do SORTED+=("$line"); done < <(printf '%s\n' "${CANDIDATES[@]}" | sort)

  # optionally learn the client_id already used by {CLIENT_NAME}, to avoid reuse
  if command -v op >/dev/null 2>&1; then
    YT_ID="$(op read "op://$VAULT/{CLIENT_NAME}/client id" 2>/dev/null || true)"
  fi

  PICK=""
  for f in "${SORTED[@]}"; do
    cid="$(field "$f" client_id || true)"
    if [[ -n "$YT_ID" && "$cid" == "$YT_ID" ]]; then continue; fi
    PICK="$f"; break
  done
  [[ -n "$PICK" ]] || PICK="${SORTED[0]}"   # all matched youtube → fall back to first
  FILE="$PICK"
fi

[[ -f "$FILE" ]] || { echo "ERROR: file not found: $FILE" >&2; exit 1; }

CID="$(field "$FILE" client_id)"
echo "Picked OAuth client:"
echo "  file:      $(basename "$FILE")"
echo "  project:   $(field "$FILE" project_id)"
echo "  client_id: $CID"
if [[ -n "$YT_ID" && "$CID" == "$YT_ID" ]]; then
  echo "  NOTE: this is the SAME client as '{CLIENT_NAME}' — Sheets + YouTube will share an OAuth client."
fi
echo ""

if [[ "$DRY" == "1" ]]; then echo "(dry-run — nothing stored)"; exit 0; fi

CSEC="$(field "$FILE" client_secret)"
if [[ -z "$CID" || -z "$CSEC" ]]; then
  echo "ERROR: could not extract client_id/client_secret from $FILE" >&2
  unset CSEC; exit 1
fi

if [[ "$DO_KEYCHAIN" == "1" ]]; then
  security add-generic-password -U -a "$ACCOUNT" -s "${NAME}-client-id"     -w "$CID"
  security add-generic-password -U -a "$ACCOUNT" -s "${NAME}-client-secret" -w "$CSEC"
  echo "Keychain  : stored ${NAME}-client-id, ${NAME}-client-secret (account=$ACCOUNT)"
fi

if [[ "$DO_OP" == "1" ]]; then
  if ! command -v op >/dev/null 2>&1; then
    echo "1Password : SKIPPED (op not on PATH)" >&2
  elif op item get "$OP_ITEM" --vault "$VAULT" >/dev/null 2>&1; then
    op item edit "$OP_ITEM" --vault "$VAULT" \
      "client id[text]=$CID" "client secret[password]=$CSEC" >/dev/null
    echo "1Password : updated '$OP_ITEM' (vault $VAULT) — client id + client secret"
  else
    op item create --category "Secure Note" --title "$OP_ITEM" --vault "$VAULT" \
      "client id[text]=$CID" "client secret[password]=$CSEC" "refresh token[password]=" >/dev/null
    echo "1Password : created '$OP_ITEM' (vault $VAULT) — client id + client secret + empty refresh token"
  fi
fi

unset CID CSEC

echo ""
echo "Done. (refresh token is minted later by the OAuth bootstrap — not in this file.)"
echo "Verify:"
echo "  op read \"op://$VAULT/$OP_ITEM/client secret\""
echo "  security find-generic-password -a $ACCOUNT -s ${NAME}-client-secret -w | wc -c"
