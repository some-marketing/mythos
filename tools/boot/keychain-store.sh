#!/usr/bin/env bash
# tools/boot/keychain-store.sh
#
# Securely store a secret in macOS Keychain without exposing it to shell history.
#
# Usage:
#   tools/boot/keychain-store.sh <service> <account>
#
# Example:
#   tools/boot/keychain-store.sh my-api-key mythos
#
# The secret is read silently via `read -s`, stored via `security`,
# then verified by re-reading and length-checking. The secret value
# is never echoed to stdout, stderr, or shell history.
#
# To retrieve later:
#   security find-generic-password -a <account> -s <service> -w
#
# Pattern: boot-time credential store. Companion to verify-credentials.cjs.

set -euo pipefail

SERVICE="${1:-}"
ACCOUNT="${2:-}"

if [[ -z "$SERVICE" || -z "$ACCOUNT" ]]; then
  echo "Usage: $0 <service> <account>"
  echo "Example: $0 my-api-key mythos"
  exit 1
fi

echo "==========================================================="
echo "  macOS Keychain — Secure Secret Storage"
echo "==========================================================="
echo "  Service: $SERVICE"
echo "  Account: $ACCOUNT"
echo "-----------------------------------------------------------"
echo ""
echo "Paste the secret and press Enter."
echo "(Your input will NOT be shown.)"
echo ""
printf "Secret: "
read -rs SECRET
echo ""
echo ""

if [[ -z "$SECRET" ]]; then
  echo "ERROR: empty input. Nothing stored."
  exit 1
fi

SECRET_LENGTH=${#SECRET}

security add-generic-password -U -a "$ACCOUNT" -s "$SERVICE" -w "$SECRET"

unset SECRET

# Capture stderr separately so failure diagnostics are preserved for the operator.
# On success the temp file is discarded; on failure the content is surfaced.
RETRIEVED_STDERR=$(mktemp -t keychain-store.stderr.XXXXXX)
RETRIEVED_LENGTH=$(security find-generic-password -a "$ACCOUNT" -s "$SERVICE" -w 2>"$RETRIEVED_STDERR" | wc -c | tr -d ' ')
RETRIEVED_LENGTH=$((RETRIEVED_LENGTH - 1))

if [[ "$RETRIEVED_LENGTH" -eq "$SECRET_LENGTH" ]]; then
  rm -f "$RETRIEVED_STDERR"
  echo "-----------------------------------------------------------"
  echo "  Stored successfully."
  echo "  Length verified: $SECRET_LENGTH characters."
  echo ""
  echo "  To retrieve in scripts:"
  echo "    security find-generic-password -a $ACCOUNT -s $SERVICE -w"
  echo ""
  echo "  To verify presence without printing the value:"
  echo "    security find-generic-password -a $ACCOUNT -s $SERVICE -w | wc -c"
  echo "==========================================================="
else
  echo "-----------------------------------------------------------"
  echo "  ERROR: stored length ($SECRET_LENGTH) != retrieved length ($RETRIEVED_LENGTH)"
  if [[ -s "$RETRIEVED_STDERR" ]]; then
    echo ""
    echo "  Diagnostic from 'security find-generic-password':"
    sed 's/^/    /' "$RETRIEVED_STDERR"
  fi
  rm -f "$RETRIEVED_STDERR"
  echo ""
  echo "  Something went wrong. Check the diagnostic above and try again."
  echo "==========================================================="
  exit 1
fi
