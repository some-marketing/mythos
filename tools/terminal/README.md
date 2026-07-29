# Per-client terminal colour

`set-client-terminal-color.js` applies a client's configured terminal
background colour, so a strict "when I work on client X, the terminal is
X's colour" rule is enforceable mechanically rather than by memory.

Reads `clients/<CODE>/config/ui.json` → `terminal_background` and applies
it to the current terminal window. Nothing about any specific client's
colour is hardcoded in the tool — every client supplies its own `ui.json`.

Ecosystem-aware: the apply path is selected from `$TERM_PROGRAM`.
`Apple_Terminal` uses AppleScript (`osascript`); `iTerm.app` uses an OSC 11
escape sequence. Other terminals warn rather than guess.

```bash
node tools/terminal/set-client-terminal-color.js --client ACME [--print]
node tools/terminal/set-client-terminal-color.js --client ACME --get   # read current bg (Apple_Terminal only)
```

Config shape (`clients/<CODE>/config/ui.json`):

```json
{
  "terminal_background": {
    "hex": "#2E3440",
    "apple_terminal_rgb16": [11822, 13364, 16448]
  }
}
```

`apple_terminal_rgb16` is authoritative for Terminal.app if present;
otherwise the hex value is converted.
