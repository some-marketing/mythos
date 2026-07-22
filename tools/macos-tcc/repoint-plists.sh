#!/bin/bash
# repoint-plists.sh — apply staged plist edits to ~/Library/LaunchAgents and reload.
#
# Usage:
#   ./repoint-plists.sh [--dry-run] [--jobs job1,job2,...]
#
# This script reads from tools/macos-tcc/plist-staged/ and:
#   1. Backs up the current ~/Library/LaunchAgents/<name>.plist
#   2. Copies the staged version over it
#   3. Reloads the launchd agent (bootout + bootstrap)
#
# OPERATOR-GATED: run interactively in a user session. Not for automated/launchd use.
# Requires: launchctl, write access to ~/Library/LaunchAgents/
#
# DO NOT run as root. DO NOT run from a launchd agent context.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGED_DIR="$REPO_ROOT/tools/macos-tcc/plist-staged"
BUNDLE_ID_PREFIX="${BUNDLE_ID_PREFIX:-com.example.mythos}"
BACKUP_DIR="$REPO_ROOT/tools/macos-tcc/plist-backups"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_VAL="$(id -u)"
DRY_RUN=false
FILTER_JOBS=""

if [[ "$UID_VAL" == "0" ]]; then
  echo "[repoint-plists] ERROR: do not run as root — these are user (gui/$UID_VAL) LaunchAgents." >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"

usage() {
  echo "Usage: $0 [--dry-run] [--jobs job1,job2,...]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --jobs)    FILTER_JOBS="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

if $DRY_RUN; then
  echo "[repoint-plists] DRY RUN — no live files changed, no launchctl calls."
fi

for staged in "$STAGED_DIR"/*.plist; do
  [[ -f "$staged" ]] || continue
  filename="$(basename "$staged")"
  label="${filename%.plist}"
  job="${label#$BUNDLE_ID_PREFIX.}"

  if [[ -n "$FILTER_JOBS" ]] && ! echo ",$FILTER_JOBS," | grep -q ",$job,"; then
    echo "[repoint-plists] skip $job (not in --jobs filter)"
    continue
  fi

  target="$LAUNCH_AGENTS/$filename"
  backup="$BACKUP_DIR/$filename.bak"

  echo "[repoint-plists] job=$job"
  echo "  staged:  $staged"
  echo "  target:  $target"
  echo "  backup:  $backup"

  if ! $DRY_RUN; then
    # Step 1: ensure a backup exists (idempotent). Skip jobs with no live target.
    if [[ ! -f "$target" ]]; then
      echo "  [SKIP] no live plist at target — nothing to repoint/back up"
      continue
    fi
    [[ -f "$backup" ]] || cp "$target" "$backup"

    # Step 2: bootout (ignore failure if not loaded)
    launchctl bootout "gui/$UID_VAL/$label" 2>/dev/null || true

    # Step 3: install staged plist
    cp "$staged" "$target"

    # Step 4: bootstrap — TRANSACTIONAL: restore the backup + re-bootstrap on failure
    # so a failed reload never leaves the job booted-out with a bad plist installed.
    if launchctl bootstrap "gui/$UID_VAL" "$target"; then
      echo "  [OK] reloaded"
    else
      echo "  [FAIL] bootstrap failed — restoring backup and re-bootstrapping original" >&2
      cp "$backup" "$target"
      launchctl bootout "gui/$UID_VAL/$label" 2>/dev/null || true
      if launchctl bootstrap "gui/$UID_VAL" "$target"; then
        echo "  [RESTORED] original plist re-bootstrapped" >&2
      else
        echo "  [ERROR] restore re-bootstrap ALSO failed for $label — job may be down; manual check needed" >&2
      fi
    fi
  else
    echo "  [DRY] would: bootout -> cp staged -> bootstrap (restore-on-failure)"
  fi
done

echo "[repoint-plists] done."
