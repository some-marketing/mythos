#!/bin/bash
# tools/backup/internxt-mind-full.sh
#
# Weekly full snapshot of a configured source directory.
#
# DESTRUCTIVE (network write): uploads an encrypted archive to your remote.
# Use --dry-run first.
#
# Usage: ./internxt-mind-full.sh [--dry-run]
#
# Configuration (env vars, see SETUP.md / env.example):
#   INTERNXT_REMOTE_NAME   rclone remote name for your Internxt (or any
#                          rclone-compatible) account. Default: myremote
#   BACKUP_BUCKET_PREFIX   top-level folder within that remote. Default: backups
#   BACKUP_SOURCE_DIR      directory (relative to repo root, or absolute) to
#                          snapshot in full. Default: backup-source

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
RCLONE_REMOTE="${REMOTE_NAME}:${BUCKET_PREFIX}/mind-fulls"
SOURCE_DIR_RAW="${BACKUP_SOURCE_DIR:-backup-source}"
case "$SOURCE_DIR_RAW" in
  /*) SOURCE_REL="$SOURCE_DIR_RAW" ; SOURCE_DIR="$SOURCE_DIR_RAW" ;;
  *)  SOURCE_REL="$SOURCE_DIR_RAW" ; SOURCE_DIR="$REPO_ROOT/$SOURCE_DIR_RAW" ;;
esac
TIMESTAMP="$(date +%Y%m%d)"
ARCHIVE="${TMPDIR:-/tmp}/backup-mind-full-${TIMESTAMP}.tar.gz.age"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN]"
fi

echo "=== Full Mind-Log Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Directory: $SOURCE_DIR"
echo "Remote: $RCLONE_REMOTE"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source directory not found: $SOURCE_DIR" >&2
  echo "       Set BACKUP_SOURCE_DIR to point at the directory you want to back up." >&2
  exit 1
fi

# Tar full directory + age-encrypt
echo "Packing and encrypting..."
if [[ "$SOURCE_DIR_RAW" = /* ]]; then
  tar czf - -C "$(dirname "$SOURCE_DIR")" "$(basename "$SOURCE_DIR")" 2>/dev/null | age -r "$PUBLIC_KEY" -o "$ARCHIVE"
else
  tar czf - -C "$REPO_ROOT" "$SOURCE_REL" 2>/dev/null | age -r "$PUBLIC_KEY" -o "$ARCHIVE"
fi
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "Archive: $ARCHIVE ($ARCHIVE_SIZE)"

# Upload via rclone
if $DRY_RUN; then
  echo "[DRY RUN] Would upload to: $RCLONE_REMOTE"
else
  echo "Uploading..."
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE/" \
    --tpslimit 10 \
    --transfers 2 \
    --retries 5 \
    --low-level-retries 10 \
    --timeout 600s \
    --contimeout 30s \
    --progress

  echo "Upload complete."
fi

# Cleanup
rm -f "$ARCHIVE"
echo "Done."
