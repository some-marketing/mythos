#!/bin/bash
# Launch Claude Code with voice in Mythos
# Bind this to a K100 macro key via iCUE → "Launch Application"
cd /Users/admin/dev/Mythos-recovered
osascript -e '
tell application "Terminal"
    activate
    do script "cd /Users/admin/dev/Mythos-recovered && claude"
end tell
'
