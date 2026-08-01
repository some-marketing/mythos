#!/usr/bin/env bash
# Install / uninstall the contextual-sweep launchd job (macOS).
# Fires every 120s, runs tools/memory/contextual-sweep.js against all fresh
# active sessions, writes hints to _dev/state/contextual-hints/.
#
# Concept: _dev/concepts/contextual-mind-tiered-attention.md (4612a04c)

set -euo pipefail

SMOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="ca.somemarketing.smos.contextual-sweep"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PLIST_TEMPLATE="$SMOS_ROOT/tools/memory/contextual-sweep.plist.template"
HINTS_DIR="$SMOS_ROOT/_dev/state/contextual-hints"

usage() {
    cat <<EOF
Usage: $(basename "$0") {install|uninstall|status|run-once}

  install    Generate launchd plist from template and load it.
             Sweep fires every 120s starting now and at every login.
  uninstall  Unload + remove the launchd plist.
  status     Show whether the agent is loaded and last log line.
  run-once   Invoke the sweep once for verification, no install.
EOF
}

case "${1:-}" in
    install)
        mkdir -p "$HINTS_DIR" "$HOME/Library/LaunchAgents"
        sed \
            -e "s|__SMOS_ROOT__|$SMOS_ROOT|g" \
            -e "s|__HOME__|$HOME|g" \
            "$PLIST_TEMPLATE" > "$PLIST_DEST"
        launchctl unload "$PLIST_DEST" 2>/dev/null || true
        launchctl load "$PLIST_DEST"
        echo "installed: $PLIST_DEST"
        echo "label:     $LABEL"
        echo "interval:  120s (matches operator default per concept §Cadence)"
        echo
        echo "verify: launchctl list | grep $LABEL"
        echo "logs:   $HINTS_DIR/_sweeper.{stdout,stderr}.log"
        ;;
    uninstall)
        if [[ -f "$PLIST_DEST" ]]; then
            launchctl unload "$PLIST_DEST" 2>/dev/null || true
            rm -f "$PLIST_DEST"
            echo "uninstalled: $PLIST_DEST"
        else
            echo "not installed (no plist at $PLIST_DEST)"
        fi
        ;;
    status)
        if launchctl list | grep -q "$LABEL"; then
            echo "loaded:"
            launchctl list | grep "$LABEL"
        else
            echo "not loaded"
        fi
        if [[ -f "$HINTS_DIR/_sweeper.stdout.log" ]]; then
            echo
            echo "last stdout line:"
            tail -1 "$HINTS_DIR/_sweeper.stdout.log" 2>/dev/null || echo "(empty)"
        fi
        if [[ -f "$HINTS_DIR/_sweeper.stderr.log" ]] && [[ -s "$HINTS_DIR/_sweeper.stderr.log" ]]; then
            echo
            echo "stderr (recent):"
            tail -5 "$HINTS_DIR/_sweeper.stderr.log"
        fi
        ;;
    run-once)
        cd "$SMOS_ROOT"
        node tools/memory/contextual-sweep.js
        ;;
    *)
        usage
        exit 1
        ;;
esac
