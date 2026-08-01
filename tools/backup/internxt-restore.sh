#!/bin/bash
# tools/backup/internxt-restore.sh
#
# Restore the latest backup of a given class from your remote.
#
# NOTE: this writes DECRYPTED PLAINTEXT to disk at the restore destination.
# It does not delete or mutate remote data, but treat the restore output as
# sensitive for as long as it exists on disk.
#
# Usage: ./internxt-restore.sh [--dry-run] [--type delta|full|repo] [--restore-to /path]
#
# Configuration (env vars, see SETUP.md / env.example):
#   INTERNXT_REMOTE_NAME    rclone remote name for your Internxt (or any
#                           rclone-compatible) account. Default: myremote
#   BACKUP_BUCKET_PREFIX    top-level folder within that remote. Default: backups
#   AGE_KEYCHAIN_ACCOUNT    macOS Keychain account holding the age private key.
#                           Default: backup-tool
#   AGE_KEYCHAIN_SERVICE    macOS Keychain service holding the age private key.
#                           Default: backup-age-key-v2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REMOTE_NAME="${INTERNXT_REMOTE_NAME:-myremote}"
BUCKET_PREFIX="${BACKUP_BUCKET_PREFIX:-backups}"

# Age private key resolved keychain-first. Materialized to a trap-guarded temp
# file just before decrypt, then vaporized on exit — never left on disk.
AGE_KEY_ACCOUNT="${AGE_KEYCHAIN_ACCOUNT:-backup-tool}"
AGE_KEY_SERVICE="${AGE_KEYCHAIN_SERVICE:-backup-age-key-v2}"
AGE_KEY=""
cleanup_age_key() { [[ -n "${AGE_KEY:-}" && -f "$AGE_KEY" ]] && rm -f "$AGE_KEY"; }
trap cleanup_age_key EXIT INT TERM
RESTORE_TO="${3:-${TMPDIR:-/tmp}/backup-restore-$(date +%Y%m%d-%H%M%S)}"
BACKUP_TYPE="${2:-delta}"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN]"
fi

case "$BACKUP_TYPE" in
  delta)  REMOTE_PATH="${REMOTE_NAME}:${BUCKET_PREFIX}/mind-deltas" ;;
  full)   REMOTE_PATH="${REMOTE_NAME}:${BUCKET_PREFIX}/mind-fulls" ;;
  repo)   REMOTE_PATH="${REMOTE_NAME}:${BUCKET_PREFIX}/repo-monthly" ;;
  *)
    echo "Usage: $0 [--dry-run] [--type delta|full|repo] [--restore-to /path]"
    exit 1
    ;;
esac

echo "=== Internxt Restore ==="
echo "Type: $BACKUP_TYPE"
echo "Remote: $REMOTE_PATH"
echo "Restore to: $RESTORE_TO"

# Find latest archive
LATEST=$(rclone lsf "$REMOTE_PATH/" --files-only --format 'sp' | sort | tail -1)
if [[ -z "$LATEST" ]]; then
  echo "Error: No archives found in $REMOTE_PATH"
  exit 1
fi
echo "Latest archive: $LATEST"

# Download
DOWNLOAD_PATH="${TMPDIR:-/tmp}/backup-restore-${LATEST}"
if $DRY_RUN; then
  echo "[DRY RUN] Would download: $REMOTE_PATH/$LATEST"
else
  echo "Downloading..."
  rclone copy "$REMOTE_PATH/$LATEST" "$(dirname "$DOWNLOAD_PATH")/" \
    --tpslimit 10 \
    --transfers 2 \
    --retries 5 \
    --progress

  echo "Decrypting..."
  # Resolve the age key from macOS Keychain (no tracked-key fallback — the
  # private key must never be committed to this repo).
  AGE_KEY="$(mktemp -t backup-restore-agekey.XXXXXX)"
  chmod 600 "$AGE_KEY"
  if ! security find-generic-password -a "$AGE_KEY_ACCOUNT" -s "$AGE_KEY_SERVICE" -w > "$AGE_KEY" 2>/dev/null || [[ ! -s "$AGE_KEY" ]]; then
    echo "Error: age private key not found in macOS Keychain" >&2
    echo "       (account '$AGE_KEY_ACCOUNT', service '$AGE_KEY_SERVICE')." >&2
    echo "       Store the key with: tools/boot/keychain-store.sh \"$AGE_KEY_SERVICE\" \"$AGE_KEY_ACCOUNT\"" >&2
    exit 1
  fi
  mkdir -p "$RESTORE_TO"
  age -d -i "$AGE_KEY" "$DOWNLOAD_PATH" | tar xzf - -C "$RESTORE_TO"
  rm -f "$DOWNLOAD_PATH"

  echo "Verifying..."
  RESTORE_COUNT=$(find "$RESTORE_TO" -type f | wc -l | tr -d ' ')
  RESTORE_SIZE=$(du -sh "$RESTORE_TO" | cut -f1)

  echo "--- Restore complete ---"
  echo "Path: $RESTORE_TO"
  echo "Files: $RESTORE_COUNT"
  echo "Size: $RESTORE_SIZE"
fi

echo "Done."
