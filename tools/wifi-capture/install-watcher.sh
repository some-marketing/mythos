#!/usr/bin/env bash
# install-watcher.sh — install/uninstall/status for the wifi-capture LaunchAgent.
#
# Operator-gated: this script renders + (un)loads the plist. The leaf worker
# does NOT call install. Spec section 5 ("Boundaries") and amendment div-5.

set -euo pipefail

if REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then :; else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

LABEL="com.mythos.wifi-capture"
TEMPLATE="$REPO_ROOT/tools/wifi-capture/com.mythos.wifi-capture.plist.template"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"
STATE_DIR="$REPO_ROOT/_dev/state"
LOCKFILE="$STATE_DIR/wifi-capture.lock"
VAULT="Wifi"

cmd="${1:-status}"

case "$cmd" in
  install)
    for bin in op jq launchctl; do
      command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
    done
    if ! op whoami >/dev/null 2>&1; then
      echo "op whoami failed — sign in to 1Password CLI before install" >&2
      exit 1
    fi
    if ! op vault list --format=json 2>/dev/null | jq -e --arg v "$VAULT" 'map(.name)|index($v)' >/dev/null; then
      echo "vault '$VAULT' not reachable for current op session" >&2
      exit 1
    fi
    mkdir -p "$TARGET_DIR" "$STATE_DIR"
    sed "s|__REPO_ROOT__|$REPO_ROOT|g" "$TEMPLATE" > "$TARGET_PLIST"
    launchctl unload "$TARGET_PLIST" >/dev/null 2>&1 || true
    launchctl load -w "$TARGET_PLIST"
    if launchctl list | grep -q "$LABEL"; then
      echo "installed: $TARGET_PLIST"
      echo "stdout log: $STATE_DIR/wifi-capture.log"
      echo "stderr log: $STATE_DIR/wifi-capture.err.log"
      echo "event log:  $STATE_DIR/wifi-capture.jsonl"
    else
      echo "launchctl load did not register $LABEL" >&2
      exit 1
    fi
    ;;
  uninstall)
    if [[ -f "$TARGET_PLIST" ]]; then
      launchctl unload "$TARGET_PLIST" >/dev/null 2>&1 || true
      rm -f "$TARGET_PLIST"
      echo "uninstalled: $TARGET_PLIST"
    else
      echo "not installed (no plist at $TARGET_PLIST)"
    fi
    ;;
  status)
    if [[ -f "$TARGET_PLIST" ]]; then
      echo "plist: installed at $TARGET_PLIST"
    else
      echo "plist: NOT installed"
    fi
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      echo "launchctl: loaded ($LABEL)"
    else
      echo "launchctl: not loaded"
    fi
    if [[ -f "$LOCKFILE" ]]; then
      pid="$(cat "$LOCKFILE" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        echo "watcher: running pid=$pid"
      else
        echo "watcher: stale lockfile (pid=$pid not alive)"
      fi
    else
      echo "watcher: no lockfile"
    fi
    ;;
  *)
    echo "usage: $0 {install|uninstall|status}" >&2
    exit 2
    ;;
esac
