#!/bin/bash
#
# voice-launch.sh — G1 button launcher for Claude Code + Voice
#
# Kills stale voice processes, opens Terminal with claude in Mythos,
# and sets G1 LED to blue. Run from iCUE G1 macro or Automator app.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MYTHOS_DIR="${MYTHOS_HOME:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}"
VENV="$MYTHOS_DIR/tools/voice/.venv/bin/python3"
LED_SCRIPT="$MYTHOS_DIR/tools/voice/k100_led.py"

# Kill stale voice processes from previous sessions
pkill -f "voice_chat.py" 2>/dev/null
pkill -f "voice_server.py" 2>/dev/null

# Set G1 LED to blue (voice active indicator)
"$VENV" "$LED_SCRIPT" blue 2>/dev/null &

# Open Terminal with Claude Code in the resolved Mythos directory.
osascript - "$MYTHOS_DIR" <<'APPLESCRIPT'
on run argv
set mythosRoot to item 1 of argv
tell application "Terminal"
    activate
    do script "cd " & quoted form of mythosRoot & " && claude"
end tell
end run
APPLESCRIPT
