#!/bin/bash
# build-and-sign.sh — build a signed .app launcher for a node entrypoint,
# so a background/launchd job can carry its own TCC (Full Disk Access,
# Automation/AppleEvents) identity instead of sharing the interpreter's.
#
# Usage:
#   ./build-and-sign.sh --job <jobname> --script <abs-path-to-entrypoint.cjs>
#
# Options:
#   --job      Job name (e.g. apple-sync). Sets CFBundleIdentifier + output dir name.
#   --script   Absolute path to the node entrypoint script.
#   --desc     NSRemindersUsageDescription override (optional)
#   --apple-events  Add NSAppleEventsUsageDescription (default: included)
#   --out-dir  Output directory (default: tools/macos-tcc/)
#   --identity Code signing identity (default: "Mythos Local Code Signing" -- replace with your own keychain identity name)
#   --node     Path to node binary (default: /usr/local/bin/node)
#   --dry-run  Print what would be done, don't write files
#
# The bundle is placed at <out-dir>/<jobname>.app
# After building, the operator must prime TCC grants by running the app once
# in the GUI session (see prime-permissions.md).
#
# Requirements: codesign (no sudo needed for self-signed/keychain identity).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/tools/macos-tcc/AppTemplate.app"
OUT_DIR="$REPO_ROOT/tools/macos-tcc"
IDENTITY="Mythos Local Code Signing"
NODE_BIN="/usr/local/bin/node"
JOB=""
NODE_SCRIPT=""
DRY_RUN=false

usage() {
  echo "Usage: $0 --job <name> --script <path> [--out-dir <dir>] [--identity <id>] [--node <path>] [--dry-run]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --job)      JOB="$2";         shift 2 ;;
    --script)   NODE_SCRIPT="$2"; shift 2 ;;
    --out-dir)  OUT_DIR="$2";     shift 2 ;;
    --identity) IDENTITY="$2";    shift 2 ;;
    --node)     NODE_BIN="$2";    shift 2 ;;
    --dry-run)  DRY_RUN=true;     shift   ;;
    -h|--help)  usage ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

[[ -z "$JOB" ]]         && { echo "ERROR: --job required"; usage; }
[[ -z "$NODE_SCRIPT" ]] && { echo "ERROR: --script required"; usage; }

BUNDLE_ID_PREFIX="${BUNDLE_ID_PREFIX:-com.example.mythos}"
BUNDLE_ID="$BUNDLE_ID_PREFIX.$JOB"
APP_DIR="$OUT_DIR/$JOB.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
INFO_PLIST="$CONTENTS/Info.plist"
LAUNCHER="$MACOS/launcher"

echo "[build-and-sign] job=$JOB bundle_id=$BUNDLE_ID"
echo "[build-and-sign] entrypoint=$NODE_SCRIPT"
echo "[build-and-sign] out=$APP_DIR"
echo "[build-and-sign] identity=$IDENTITY"
echo "[build-and-sign] node=$NODE_BIN"

if $DRY_RUN; then
  echo "[build-and-sign] DRY RUN — no files written."
  exit 0
fi

# 1. Copy template
cp -R "$TEMPLATE_DIR" "$APP_DIR"

# 2. Stamp bundle id + name in Info.plist
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$INFO_PLIST"
plutil -replace CFBundleName        -string "$JOB"       "$INFO_PLIST"
plutil -replace CFBundleDisplayName -string "$JOB" "$INFO_PLIST"

# 3. Write the launcher script for this specific entrypoint
cat > "$LAUNCHER" <<LAUNCHER_BODY
#!/bin/bash
set -euo pipefail
export HOME="\${HOME:?HOME must be set in the launchd plist EnvironmentVariables}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
exec "$NODE_BIN" "$NODE_SCRIPT"
LAUNCHER_BODY
chmod +x "$LAUNCHER"

# 4. Remove template CodeSignature (will re-sign)
rm -rf "$CONTENTS/_CodeSignature"

# 5. Sign (no sudo required for keychain identity)
if codesign --sign "$IDENTITY" \
            --identifier "$BUNDLE_ID" \
            --options runtime \
            --timestamp \
            --deep \
            --force \
            "$APP_DIR" 2>&1; then
  echo "[build-and-sign] signed OK"
else
  echo "[build-and-sign] WARNING: codesign failed — bundle built unsigned."
  echo "[build-and-sign] Operator must run: codesign --sign '$IDENTITY' --identifier '$BUNDLE_ID' --options runtime --deep --force '$APP_DIR'"
fi

echo "[build-and-sign] DONE: $APP_DIR"
echo "[build-and-sign] Next: run prime-permissions.md steps to grant TCC access."
