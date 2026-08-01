#!/bin/bash
# Launch Claude Code with voice in Mythos
# Bind this to a K100 macro key via iCUE → "Launch Application"
cd {MYTHOS_ROOT}
osascript -e '
tell application "Terminal"
    activate
    do script "cd {MYTHOS_ROOT} && claude"
end tell
'
