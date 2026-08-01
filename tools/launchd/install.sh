#!/usr/bin/env bash
set -euo pipefail

SERVICE_ID="${1:-}"
if [[ -z "$SERVICE_ID" ]]; then
  echo "Usage: tools/launchd/install.sh <service-id> [--dry-run]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="org.mythos.portable.${SERVICE_ID}"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
BACKUP_DIR="${ROOT}/_dev/state/host-activation/backups"
RECEIPT_DIR="${ROOT}/_dev/state/host-activation/receipts"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
node "$ROOT/tools/launchd/render-plist.cjs" "$SERVICE_ID" > "$TMP"
plutil -lint "$TMP" >/dev/null

if [[ "${2:-}" == "--dry-run" ]]; then
  echo "DRY_RUN label=$LABEL destination=$DEST"
  exit 0
fi

mkdir -p "$BACKUP_DIR" "$RECEIPT_DIR" "$(dirname "$DEST")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f "$DEST" ]]; then
  cp "$DEST" "$BACKUP_DIR/${LABEL}.${STAMP}.plist"
fi
cp "$TMP" "$DEST"
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null
printf '{"schema":"MythosActivationReceipt/1.0","service":"%s","installed_at":"%s","destination":"%s"}\n' \
  "$SERVICE_ID" "$STAMP" "$DEST" > "$RECEIPT_DIR/${SERVICE_ID}.json"
echo "ACTIVE_VERIFIED $SERVICE_ID"
