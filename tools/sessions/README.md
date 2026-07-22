# Active Session Registry + Hook Dispatcher

A local registry for active agent sessions, plus a harness hook dispatcher
that wires session lifecycle events (register/heartbeat/close) into a
file-lane pattern — durable JSON records, no external signaling runtime
required.

## Two pieces

- **`lib/active-session-registry.js`** — file-per-session at
  `_dev/state/active-sessions/<session-id>.json`, TTL-based liveness via
  `_dev/state/active-sessions/_ttl-policy.json`, atomic temp+rename writes,
  idempotent re-register with mutable-field updates, `sweepExpired()` for
  stale cleanup. On close (or on sweeping an expired/crashed session) it
  emits a `CascadeSpan/1.0` lineage record via a local, self-contained stand-in
  (see the top of the file) — swap that stand-in for a real cascade-span
  library if you build one; the call sites don't change.
- **`hooks/coordination-dispatcher.js`** — a unified Node entry point invoked
  from Claude Code hooks (`SessionStart`, `UserPromptSubmit`,
  `PreToolUse:Bash`, `PostToolUse:Write|Edit|MultiEdit`, `SessionEnd`).
  Handles register/heartbeat/close for the session it's running in. This is
  a self-contained file: it only requires the local `active-session-registry`
  module plus Node built-ins — no private signals runtime dependency.

## CLI

```bash
node tools/sessions/session.js register \
  --session-id=worker-1 \
  --actor-id=claude-opus-4-7:my-workstream \
  --actor-type=claude-opus-4-7 \
  --current-branch=feat/my-feature \
  --working-surface=frameworks/meta/execution-normalization
node tools/sessions/session.js heartbeat --session-id=worker-1
node tools/sessions/session.js list
node tools/sessions/session.js sweep
node tools/sessions/session.js close --session-id=worker-1
```

## Hook wiring

Wire `coordination-dispatcher.js` into `.claude/settings.json` per event, the
same pattern as any other hook in this tree (see `tools/hooks/README.md`).
Each hook event resolves the session id from `CLAUDE_SESSION_ID` (or your own
env var — see the dispatcher's `MYTHOS_SESSION_ID` fallback) and calls the
matching registry function.

## Storage layout

```
_dev/state/active-sessions/
├── _ttl-policy.json            # per-actor-type TTL config
├── _current-id                 # this-session sidecar (written by SessionStart hook)
├── <session-id>.json           # one per active session
└── closed/
    └── <session-id>.json       # archived on close or sweep
```

## TTL by actor

Edit `_dev/state/active-sessions/_ttl-policy.json` to tune. Defaults are a
starting point — set your own per actor-type:

| Actor type | TTL | Heartbeat |
|---|---|---|
| claude-opus-4-7 / sonnet-4-6 | 30 min | every 2-5 min |
| claude-haiku-4-5 | 15 min | every 2 min |
| codex-managed | 20 min | every dispatch |
| scheduled-job | 2x expected interval | at start + end |
| ci-shortjob | 10 min | start + halfway |
| long-daemon | 60 min | every 5 min |
| background-agent | 15 min | each tool round |

## What isn't here, and why

The source this was ported from wired session close events into a private
cross-actor signal-dispatch runtime (schema validation, a live signal
scanner, a lifecycle-completion driver) — none of which ships in this
scaffold. `active-session-registry.js`'s cascade-span emission has
been reduced to a local, self-contained stand-in rather than a real
dependency on that private runtime; `coordination-dispatcher.js` was already
self-contained and needed no changes beyond an env-var rename. If you build
your own cross-actor signaling layer, the natural integration point is
inside `emitCloseSpan()` in `active-session-registry.js`.

## Tests

Source tests live at `lib/__tests__/active-session-registry.test.js` and
`hooks/__tests__/coordination-dispatcher.test.js` in the original repo (not
ported here — they exercise the private signal-integration surface this
scaffold no longer has). Write your own tests against the shipped behavior:
register/heartbeat/list/sweep/close, and the hook dispatcher's per-event
handlers.
