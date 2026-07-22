#!/usr/bin/env bash
# watch-ssid.sh — long-running poll watcher; spawns capture-on-connect.sh on debounced SSID changes.
# No password handling here. Lockfile cleaned on every exit. INT/TERM/HUP exit cleanly.
set -euo pipefail

if REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then :; else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

STATE_DIR="$REPO_ROOT/_dev/state"
LOG="$STATE_DIR/wifi-capture.jsonl"
LOCKFILE="$STATE_DIR/wifi-capture.lock"
INTERFACE="${WIFI_INTERFACE:-en0}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
DEBOUNCE_SECONDS="${DEBOUNCE_SECONDS:-10}"
CAPTURE_SCRIPT="$REPO_ROOT/tools/wifi-capture/capture-on-connect.sh"

mkdir -p "$STATE_DIR"

log_jsonl() {
  local event="$1" ssid="$2" status="$3" detail="$4"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -nc \
    --arg ts "$ts" --arg event "$event" --arg ssid "$ssid" \
    --arg status "$status" --arg detail "$detail" \
    '{ts:$ts, event:$event, ssid:$ssid, status:$status, detail:$detail}' \
    >> "$LOG"
}

if [[ -f "$LOCKFILE" ]]; then
  OLD_PID="$(cat "$LOCKFILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    log_jsonl watcher "" skip "already running pid=$OLD_PID"
    exit 0
  fi
fi
echo "$$" > "$LOCKFILE"

cleanup() {
  rm -f "$LOCKFILE" || true
  log_jsonl watcher "" stop "exit"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

log_jsonl watcher "" start "poll=${POLL_INTERVAL}s debounce=${DEBOUNCE_SECONDS}s"

last_ssid=""
pending_ssid=""
pending_since=0

while :; do
  raw="$(networksetup -getairportnetwork "$INTERFACE" 2>/dev/null || true)"
  current="${raw#Current Wi-Fi Network: }"
  if [[ "$raw" == "$current" ]]; then current=""; fi

  if [[ "$current" != "$last_ssid" ]]; then
    if [[ -z "$current" ]]; then
      log_jsonl disconnect "$last_ssid" ok "interface=$INTERFACE"
      last_ssid=""
      pending_ssid=""
      pending_since=0
    elif [[ "$current" != "$pending_ssid" ]]; then
      pending_ssid="$current"
      pending_since="$(date +%s)"
      log_jsonl pending "$current" ok "debouncing"
    else
      now="$(date +%s)"
      if (( now - pending_since >= DEBOUNCE_SECONDS )); then
        last_ssid="$current"
        pending_ssid=""
        pending_since=0
        log_jsonl connect "$current" ok "firing capture"
        if ! bash "$CAPTURE_SCRIPT" >/dev/null 2>&1; then
          log_jsonl capture-error "$current" fail "capture exited nonzero"
        fi
      fi
    fi
  fi
  sleep "$POLL_INTERVAL"
done
