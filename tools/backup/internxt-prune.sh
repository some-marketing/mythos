#!/bin/bash
# tools/backup/internxt-prune.sh
#
# Enforce a retention policy on your remote's backup directories.
#
# DESTRUCTIVE: permanently deletes remote objects older than the retention
# window for each backup class. Always run --dry-run first and read its
# output before running for real.
#
# Usage: ./internxt-prune.sh [--dry-run]
#
# Configuration (env vars, see SETUP.md / env.example):
#   INTERNXT_REMOTE_NAME   rclone remote name for your Internxt (or any
#                          rclone-compatible) account. Default: myremote
#   BACKUP_BUCKET_PREFIX   top-level folder within that remote. Default: backups

set -euo pipefail

REMOTE_NAME="${INTERNXT_REMOTE_NAME:-myremote}"
BUCKET_PREFIX="${BACKUP_BUCKET_PREFIX:-backups}"
RCLONE_REMOTE="${REMOTE_NAME}:${BUCKET_PREFIX}"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN]"
fi

echo "=== Internxt Backup Pruning ==="
echo "Remote: $RCLONE_REMOTE"

if ! $DRY_RUN; then
  echo "This is a DESTRUCTIVE run (no --dry-run). Deletions below are permanent."
fi

# Daily deltas: keep last 14 days
echo "Pruning mind-deltas (keep 14 days)..."
if $DRY_RUN; then
  rclone delete --dry-run --min-age 14d "$RCLONE_REMOTE/mind-deltas/"
else
  rclone delete --min-age 14d "$RCLONE_REMOTE/mind-deltas/"
fi

# Weekly fulls: keep last 8 weeks
echo "Pruning mind-fulls (keep 8 weeks)..."
if $DRY_RUN; then
  rclone delete --dry-run --min-age 56d "$RCLONE_REMOTE/mind-fulls/"
else
  rclone delete --min-age 56d "$RCLONE_REMOTE/mind-fulls/"
fi

# Monthly fulls: keep last 12 months
echo "Pruning repo-monthly (keep 12 months)..."
if $DRY_RUN; then
  rclone delete --dry-run --min-age 365d "$RCLONE_REMOTE/repo-monthly/"
else
  rclone delete --min-age 365d "$RCLONE_REMOTE/repo-monthly/"
fi

echo "Done."
