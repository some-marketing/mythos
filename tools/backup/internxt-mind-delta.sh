#!/bin/bash
# tools/backup/internxt-mind-delta.sh
#
# Daily delta backup: only files modified in the last 24 hours under a
# configured source directory. Uses native rclone (check your provider's
# plan tier — some rclone-compatible remotes gate native rclone access
# behind a higher plan).
#
# DESTRUCTIVE (network write): uploads an encrypted archive to your remote.
# Use --dry-run first.
#
# Usage: ./internxt-mind-delta.sh [--dry-run]
#
# Configuration (env vars, see SETUP.md / env.example):
#   INTERNXT_REMOTE_NAME   rclone remote name for your Internxt (or any
#                          rclone-compatible) account. Default: myremote
#   BACKUP_BUCKET_PREFIX   top-level folder within that remote. Default: backups
#   BACKUP_SOURCE_DIR      directory (relative to repo root, or absolute) to
#                          watch for daily deltas. Default: backup-source

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Recipient resolved from the tracked v2 public-key file. Public keys are safe
# to track — replace age-recipient-v2.pub with your own `age-keygen -y` output.
PUBLIC_KEY="$(grep -m1 '^age1' "$SCRIPT_DIR/age-recipient-v2.pub" 2>/dev/null || true)"
if [[ -z "$PUBLIC_KEY" ]]; then
  echo "Error: no age recipient found in $SCRIPT_DIR/age-recipient-v2.pub" >&2
  exit 1
fi

REMOTE_NAME="${INTERNXT_REMOTE_NAME:-myremote}"
BUCKET_PREFIX="${BACKUP_BUCKET_PREFIX:-backups}"
RCLONE_REMOTE="${REMOTE_NAME}:${BUCKET_PREFIX}/mind-deltas"
SOURCE_DIR_RAW="${BACKUP_SOURCE_DIR:-backup-source}"
case "$SOURCE_DIR_RAW" in
  /*) SOURCE_DIR="$SOURCE_DIR_RAW" ;;
  *)  SOURCE_DIR="$REPO_ROOT/$SOURCE_DIR_RAW" ;;
esac
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${TMPDIR:-/tmp}/backup-mind-delta-${TIMESTAMP}.tar.gz.age"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN]"
fi

echo "=== Mind-Log Delta Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Source: $SOURCE_DIR"
echo "Remote: $RCLONE_REMOTE"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source directory not found: $SOURCE_DIR" >&2
  echo "       Set BACKUP_SOURCE_DIR to point at the directory you want to back up." >&2
  exit 1
fi

# Find files modified in the last 24 hours
FILE_LIST="${TMPDIR:-/tmp}/backup-mind-delta-files-${TIMESTAMP}.txt"
find "$SOURCE_DIR" -type f -mtime -1 > "$FILE_LIST"
FILE_COUNT=$(wc -l < "$FILE_LIST" | tr -d ' ')
echo "Files modified in last 24h: $FILE_COUNT"

if [[ "$FILE_COUNT" -eq 0 ]]; then
  echo "No files changed. Nothing to back up."
  rm -f "$FILE_LIST"
  exit 0
fi

# Tar + age-encrypt
echo "Packing and encrypting..."
tar czf - -T "$FILE_LIST" 2>/dev/null | age -r "$PUBLIC_KEY" -o "$ARCHIVE"
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "Archive: $ARCHIVE ($ARCHIVE_SIZE)"

# Upload via native rclone
if $DRY_RUN; then
  echo "[DRY RUN] Would upload to: $RCLONE_REMOTE"
else
  echo "Uploading..."
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE/" \
    --tpslimit 10 \
    --transfers 2 \
    --retries 5 \
    --low-level-retries 10 \
    --timeout 300s \
    --contimeout 30s
  echo "Upload complete."
fi

# Cleanup
rm -f "$ARCHIVE" "$FILE_LIST"
echo "Done."
