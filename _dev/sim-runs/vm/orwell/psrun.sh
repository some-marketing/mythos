#!/usr/bin/env bash
# Run a PowerShell script on orwell via -EncodedCommand (UTF-16LE base64).
# Avoids cmd.exe -> powershell quoting entirely.
# Usage: psrun.sh <script-file>
set -euo pipefail
f="$1"
name="$(basename "$f")"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LOG_DIR="$REPO_ROOT/_dev/state/orwell-transcripts"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date -u +%Y%m%dT%H%M%SZ)__$$__${name}.log"

enc=$(iconv -f UTF-8 -t UTF-16LE "$f" | base64 | tr -d '\n')
ssh -o ConnectTimeout=30 orwell "powershell -NoProfile -NonInteractive -EncodedCommand $enc" 2>&1 \
  | grep -v -e '^\*\* WARNING: connection is not using' \
             -e '^\*\* This session may be vulnerable' \
             -e '^\*\* The server may need to be upgraded' \
  | tee "$LOG_FILE"
status=${PIPESTATUS[0]}
printf 'transcript: %s\n' "$LOG_FILE"
exit "$status"
