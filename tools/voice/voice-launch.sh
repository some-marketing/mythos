#!/bin/bash
#
# voice-launch.sh — G1 button launcher for Claude Code + Voice
#
# Kills stale voice processes, opens Terminal with claude in Mythos,
# and sets G1 LED to blue. Run from iCUE G1 macro or Automator app.
#

SMOS_DIR="$HOME/Documents/GitHub/Mythos"
VENV="$SMOS_DIR/tools/voice/.venv/bin/python3"
LED_SCRIPT="$SMOS_DIR/tools/voice/k100_led.py"

# Kill stale voice processes from previous sessions
pkill -f "voice_chat.py" 2>/dev/null
pkill -f "voice_server.py" 2>/dev/null

# Set G1 LED to blue (voice active indicator)
"$VENV" "$LED_SCRIPT" blue 2>/dev/null &

# Open Terminal with Claude Code in Mythos directory
osascript <<'APPLESCRIPT'
tell application "Terminal"
    activate
    do script "cd ~/Documents/GitHub/Mythos && claude"
end tell
APPLESCRIPT
