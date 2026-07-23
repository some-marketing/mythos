# KILL-SWITCH — pretool-loop-layer-gate.cjs

One-step disarm / rollback for the Self-Improving Loop Protocol classification hook.

## Current state: UNARMED (safe by default)

The hook ships **UNARMED**. It is a pure classification + notice engine:

- `const ARMED = false;` at the top of `tools/kernel/hooks/pretool-loop-layer-gate.cjs`.
- It ALWAYS `exit 0` — it can block nothing.
- It is NOT registered in `.claude/settings.json` and NOT wired into
  `tools/kernel/hooks/dispatch-pretool.cjs`.

In this state there is nothing to roll back — the hook has no effect on any tool call.

## If the hook has been ARMED (post-GATE-bootstrap) and must be disarmed NOW

Arming requires TWO independent things (both operator-gated at GATE-bootstrap):
1. Flipping `ARMED` to `true` in the hook, AND
2. Registering the hook as a PreToolUse entry (settings.json / dispatch-pretool.cjs).

To disarm, break EITHER — the fastest single step is #1:

### One-step disarm (fastest)

Edit `tools/kernel/hooks/pretool-loop-layer-gate.cjs`:

```
const ARMED = true;   →   const ARMED = false;
```

That single edit forces every code path back to `exit 0`. No other change is
required; the classification logic keeps running (so NOTICEs still appear) but
it can no longer block a tool call.

### Full unwire (belt-and-suspenders)

1. Set `ARMED = false` (above).
2. Remove the `pretool-loop-layer-gate.cjs` entry from the PreToolUse hook list
   in `.claude/settings.json` (and any dispatch registration in
   `tools/kernel/hooks/dispatch-pretool.cjs`).
3. Restart the harness / open a new session so the hook config reloads.

## Verify disarmed

```
node -e "console.log(require('./tools/kernel/hooks/pretool-loop-layer-gate.cjs').ARMED)"
# expect: false
```

```
printf '{"tool_input":{"file_path":"instructions/canonical/x.yaml","content":"verdict: pass"}}' \
  | MYTHOS_LOOP_INSTANCE={CLIENT_CODE}-ads node tools/kernel/hooks/pretool-loop-layer-gate.cjs; echo "exit=$?"
# expect: a NOTICE line on stderr, exit=0
```

An armed-and-registered hook is the ONLY configuration that can block. Absent
either condition, the hook is inert.
