#!/usr/bin/env bash
# tools/credentials/store-oauth-to-keychain.sh
#
# Import a downloaded Google OAuth *client* JSON (client_id + client_secret)
# into the macOS Keychain. The secret is read from the file ON-DEVICE, stored
# via `security`, and verified by length. The secret value is NEVER printed to
# stdout/stderr, and the file path — not the secret — is what appears in argv.
#
# Usage:
#   tools/credentials/store-oauth-to-keychain.sh <client_secret_*.json> <name>
#
# Example:
#   tools/credentials/store-oauth-to-keychain.sh \
#     "$HOME/Downloads/Client Secrets/client_secret_356...googleusercontent.com.json" \
#     mythos-google-oauth-client
#
# Retrieve later (scripts):
#   security find-generic-password -a Mythos -s <name>-client-id     -w
#   security find-generic-password -a Mythos -s <name>-client-secret -w
#
# Refresh token (minted later by the OAuth bootstrap, not in this file):
#   security add-generic-password -U -a Mythos -s <name>-refresh-token -w   # interactive paste
#
# NOTE (single-user Mac): `security -w "$VALUE"` briefly exposes the value in
# this process's argv (visible to same-user `ps`). Acceptable on a single-user
# machine; the value is never written to history, a file, or this script's output.

set -euo pipefail

FILE="${1:-}"
NAME="${2:-}"
ACCOUNT="Mythos"

if [[ -z "$FILE" || -z "$NAME" ]]; then
  echo "Usage: $0 <oauth-client-json> <name>" >&2
  echo "Example: $0 \"\$HOME/Downloads/Client Secrets/client_secret_...json\" mythos-google-oauth-client" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "ERROR: file not found: $FILE" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH" >&2; exit 1; }

# Extract on-device. node receives the FILE PATH in argv (not the secret);
# the values are captured into shell vars and never echoed.
EXTRACT='const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const o=c.installed||c.web||{};process.stdout.write((o[process.argv[2]]||""));'
CLIENT_ID="$(node -e "$EXTRACT" "$FILE" client_id)"
CLIENT_SECRET="$(node -e "$EXTRACT" "$FILE" client_secret)"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "ERROR: could not read client_id/client_secret from $FILE" >&2
  echo "       (is it a Google OAuth *client* JSON with an 'installed' or 'web' block?)" >&2
  unset CLIENT_ID CLIENT_SECRET
  exit 1
fi

security add-generic-password -U -a "$ACCOUNT" -s "${NAME}-client-id"     -w "$CLIENT_ID"
security add-generic-password -U -a "$ACCOUNT" -s "${NAME}-client-secret" -w "$CLIENT_SECRET"

# Verify by length only — never print the values.
ID_LEN=$(( $(security find-generic-password -a "$ACCOUNT" -s "${NAME}-client-id"     -w 2>/dev/null | wc -c | tr -d ' ') - 1 ))
SEC_LEN=$(( $(security find-generic-password -a "$ACCOUNT" -s "${NAME}-client-secret" -w 2>/dev/null | wc -c | tr -d ' ') - 1 ))
unset CLIENT_ID CLIENT_SECRET

echo "==========================================================="
echo "  Stored Google OAuth client in Keychain (account=$ACCOUNT)"
echo "-----------------------------------------------------------"
echo "  ${NAME}-client-id      (len ${ID_LEN})"
echo "  ${NAME}-client-secret  (len ${SEC_LEN})"
echo ""
echo "  Retrieve in scripts:"
echo "    security find-generic-password -a $ACCOUNT -s ${NAME}-client-id     -w"
echo "    security find-generic-password -a $ACCOUNT -s ${NAME}-client-secret -w"
echo ""
echo "  Refresh token (added later by the OAuth bootstrap):"
echo "    security add-generic-password -U -a $ACCOUNT -s ${NAME}-refresh-token -w"
echo "==========================================================="
