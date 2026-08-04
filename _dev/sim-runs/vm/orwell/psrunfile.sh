#!/usr/bin/env bash
# Upload a PowerShell script to orwell's dedicated staging path and run it there.
# Used for scripts too large for cmd.exe's 8191-char -EncodedCommand limit.
# Usage: psrunfile.sh <script-file> [args...]
set -euo pipefail
f="$1"; shift || true
name="$(basename "$f")"
dest_dir='D:/HyperV/AntWorld/Logs/_run'

# FAIL CLOSED ON NON-ASCII.
# PowerShell 5.1 reads a BOM-less file as Windows-1252, so a UTF-8 em-dash
# arrives as mojibake whose trailing byte is a smart quote -- and PowerShell
# honours smart quotes as string delimiters. The result is a script that fails
# to tokenize, reporting "missing terminator" against the LAST line of the file,
# which points nowhere near the actual cause. Catch it here instead.
if LC_ALL=C grep -q '[^ -~	]' "$f"; then
  echo "FATAL: $name contains non-ASCII characters; PowerShell 5.1 will mis-parse it." >&2
  LC_ALL=C grep -n '[^ -~	]' "$f" | head -10 >&2
  exit 1
fi

ssh -o ConnectTimeout=30 orwell "powershell -NoProfile -NonInteractive -Command \"New-Item -ItemType Directory -Path 'D:\\HyperV\\AntWorld\\Logs\\_run' -Force | Out-Null\"" >/dev/null 2>&1

scp -q "$f" "orwell:${dest_dir}/${name}"

# Scripts dot-source courier-lib.ps1 and invoke each other by $PSScriptRoot path
# (run-job calls harvest-results, for example). Ship every sibling .ps1 so the
# remote copies resolve, rather than guessing the dependency graph per script.
# Each is checked for non-ASCII on the same fail-closed rule.
srcdir="$(dirname "$f")"
for sib in "$srcdir"/*.ps1; do
  [ -f "$sib" ] || continue
  sibname="$(basename "$sib")"
  [ "$sibname" = "$name" ] && continue
  if LC_ALL=C grep -q '[^ -~	]' "$sib"; then
    echo "FATAL: $sibname contains non-ASCII characters; PowerShell 5.1 will mis-parse it." >&2
    exit 1
  fi
  scp -q "$sib" "orwell:${dest_dir}/${sibname}"
done

ssh -o ConnectTimeout=30 orwell \
  "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${dest_dir}/${name} $*" 2>&1 \
  | grep -v -e '^\*\* WARNING: connection is not using' \
             -e '^\*\* This session may be vulnerable' \
             -e '^\*\* The server may need to be upgraded'
