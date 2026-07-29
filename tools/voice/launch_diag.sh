#!/bin/bash
# Diagnostic wrapper — logs everything to a file so we can see why Claude Code fails
LOG="/tmp/voice-mcp-diag.log"
echo "=== $(date) ===" >> "$LOG"
echo "PID: $$" >> "$LOG"
echo "CWD: $(pwd)" >> "$LOG"
echo "STDIN isatty: $(test -t 0 && echo yes || echo no)" >> "$LOG"
echo "STDOUT isatty: $(test -t 1 && echo yes || echo no)" >> "$LOG"
exec /Users/admin/dev/Mythos-recovered/tools/voice/.venv/bin/python3 /Users/admin/dev/Mythos-recovered/tools/voice/voice_server.py 2>> "$LOG"
