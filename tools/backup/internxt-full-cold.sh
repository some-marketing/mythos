#!/bin/bash
# tools/backup/internxt-full-cold.sh
#
# Monthly full repo archive (cold storage).
# Excludes node_modules and .git.
#
# DESTRUCTIVE (network write): uploads an encrypted archive to your remote and
# deletes the local temp archive afterward. Use --dry-run first.
#
# Usage: ./internxt-full-cold.sh [--dry-run]
#
# Configuration (env vars, see SETUP.md / env.example):
#   INTERNXT_REMOTE_NAME   rclone remote name for your Internxt (or any
#                          rclone-compatible) account. Default: myremote
#   BACKUP_BUCKET_PREFIX   top-level folder within that remote. Default: backups

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
RCLONE_REMOTE="${REMOTE_NAME}:${BUCKET_PREFIX}/repo-monthly"
TIMESTAMP="$(date +%Y%m%d)"
ARCHIVE="${TMPDIR:-/tmp}/backup-full-cold-${TIMESTAMP}.tar.gz.age"
MANIFEST="${TMPDIR:-/tmp}/backup-full-cold-${TIMESTAMP}.manifest.txt"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN]"
fi

echo "=== Full Repo Cold Archive ==="
echo "Timestamp: $TIMESTAMP"
echo "Repo: $REPO_ROOT"
echo "Remote: $RCLONE_REMOTE"

# Generate manifest
echo "Generating manifest..."
cd "$REPO_ROOT"
find . -type f \
  ! -path './node_modules/*' \
  ! -path './.git/*' \
  -exec sha256sum {} \; > "$MANIFEST"
MANIFEST_LINES=$(wc -l < "$MANIFEST" | tr -d ' ')
echo "Manifest: $MANIFEST_LINES files"

# Tar + age-encrypt
echo "Packing and encrypting (this may take a while)..."
tar czf - . \
  --exclude='node_modules' \
  --exclude='.git' \
  2>/dev/null | age -r "$PUBLIC_KEY" -o "$ARCHIVE"
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "Archive: $ARCHIVE ($ARCHIVE_SIZE)"

# Upload manifest first
if $DRY_RUN; then
  echo "[DRY RUN] Would upload manifest + archive to: $RCLONE_REMOTE"
else
  echo "Uploading manifest..."
  rclone copy "$MANIFEST" "$RCLONE_REMOTE/" \
    --tpslimit 10 \
    --transfers 2 \
    --retries 5

  echo "Uploading archive (this may take hours)..."
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE/" \
    --tpslimit 10 \
    --transfers 2 \
    --retries 5 \
    --low-level-retries 10 \
    --timeout 3600s \
    --contimeout 60s \
    --progress

  echo "Upload complete."
fi

# Cleanup
rm -f "$ARCHIVE" "$MANIFEST"
echo "Done."
