---
description: Run a deterministic Mythos command handler through the managed Codex runtime.
argument-hint: /command args
---

$ARGUMENTS

Run this deterministic command from the Mythos repository root:

```bash
npm run codex:mythos -- command "$ARGUMENTS"
```

Report the command output. Do not manually simulate the slash command process unless the executable reports that no deterministic handler exists yet.
