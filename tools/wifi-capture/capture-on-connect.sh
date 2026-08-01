#!/usr/bin/env bash
# capture-on-connect.sh — one-shot wifi password capture into 1Password vault "Wifi".
# Constitutional: no password byte transits stdout/log/LLM params; reads/writes on-device.
# Usage: capture-on-connect.sh [--dry-run]
# Exit: 0 ok/skip, 1 precond, 2 vault-miss, 3 keychain, 4 not-connected, 5 op-auth.
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

if REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then :; else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

STATE_DIR="$REPO_ROOT/_dev/state"
LOG="$STATE_DIR/wifi-capture.jsonl"
VAULT="Wifi"
INTERFACE="${WIFI_INTERFACE:-en0}"

mkdir -p "$STATE_DIR"

cleanup() { unset WIFI_PASSWORD || true; }
trap cleanup EXIT INT TERM HUP

log_jsonl() {
  # args: event ssid status detail
  local event="$1" ssid="$2" status="$3" detail="$4"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -nc \
    --arg ts "$ts" --arg event "$event" --arg ssid "$ssid" \
    --arg status "$status" --arg detail "$detail" \
    '{ts:$ts, event:$event, ssid:$ssid, status:$status, detail:$detail}' \
    >> "$LOG"
}

for bin in op jq security networksetup; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    log_jsonl precond "" fail "missing:$bin"
    exit 1
  fi
done

# op auth probe — fail closed (no token fetching here)
if ! op whoami >/dev/null 2>&1; then
  log_jsonl op-auth "" fail "op whoami unauthenticated"
  exit 5
fi

RAW="$(networksetup -getairportnetwork "$INTERFACE" 2>/dev/null || true)"
SSID="${RAW#Current Wi-Fi Network: }"
if [[ -z "$RAW" || "$RAW" == *"not associated"* || "$RAW" == "$SSID" ]]; then
  log_jsonl ssid "" fail "not connected on $INTERFACE"
  exit 4
fi

# Vault probe
if ! op vault list --format=json 2>/dev/null | jq -e --arg v "$VAULT" 'map(.name)|index($v)' >/dev/null; then
  log_jsonl vault "$SSID" fail "vault $VAULT not reachable"
  exit 2
fi

TITLE="Wi-Fi: $SSID"
MODE=""
if op item get "$TITLE" --vault "$VAULT" >/dev/null 2>&1; then
  EXISTING_PW="$(op item get "$TITLE" --vault "$VAULT" --fields password --reveal 2>/dev/null || true)"
  if [[ -n "$EXISTING_PW" ]]; then
    unset EXISTING_PW
    log_jsonl skip "$SSID" ok "already populated"
    exit 0
  fi
  unset EXISTING_PW
  MODE="update"
else
  MODE="create"
fi

WIFI_PASSWORD="$(security find-generic-password -wa "$SSID" 2>/dev/null || true)"
if [[ -z "${WIFI_PASSWORD:-}" ]]; then
  log_jsonl keychain "$SSID" fail "keychain denied or absent"
  exit 3
fi

PW_LEN="${#WIFI_PASSWORD}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log_jsonl dry-run "$SSID" ok "mode=$MODE pw_len=$PW_LEN"
  exit 0
fi

if [[ "$MODE" == "create" ]]; then
  if op item create \
        --category=login --vault="$VAULT" --title="$TITLE" \
        --tags=wifi,auto-captured \
        "username=$SSID" "password=$WIFI_PASSWORD" \
        >/dev/null 2>&1; then
    log_jsonl created "$SSID" ok "mode=create pw_len=$PW_LEN"
  else
    log_jsonl created "$SSID" fail "op item create failed"
    exit 1
  fi
else
  if op item edit "$TITLE" --vault="$VAULT" "password=$WIFI_PASSWORD" >/dev/null 2>&1; then
    log_jsonl updated "$SSID" ok "mode=update pw_len=$PW_LEN"
  else
    log_jsonl updated "$SSID" fail "op item edit failed"
    exit 1
  fi
fi

exit 0
