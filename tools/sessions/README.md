# Active Session Registry + Coordination Dispatcher

Local registry for active Mythos agent sessions, plus the harness hook dispatcher that wires `HandoffSignal/2.0` into self-driving lifecycle. Implements Layers 3.6 (registry) and 3 (dispatcher) of `_dev/concepts/active-session-signal-awareness-and-work-claim-hook.md`.

## Two pieces

- **`lib/active-session-registry.js`** — file-per-session at `_dev/state/active-sessions/<session-id>.json`, TTL-based liveness via `_dev/state/active-sessions/_ttl-policy.json`, atomic temp+rename writes, idempotent re-register with mutable-field updates, `sweepExpired()` for stale cleanup.
- **`hooks/coordination-dispatcher.js`** — unified node entry point invoked from claude-code hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse:Bash`, `PostToolUse:Write|Edit|MultiEdit`, `SessionEnd`) and from codex managed-runtime via `tools/codex/lib/hook-emulation.js`. Handles register/heartbeat/close + signal scan + lifecycle completion stubs.

## CLI

```bash
node tools/sessions/session.js register \
  --session-id=codex-1 \
  --actor-id=claude-opus-4-7:kerneling-rupert \
  --actor-type=claude-opus-4-7 \
  --current-branch=feat/multi-session-coordination \
  --working-surface=frameworks/meta/execution-normalization
node tools/sessions/session.js heartbeat --session-id=codex-1
node tools/sessions/session.js list
node tools/sessions/session.js sweep
node tools/sessions/session.js close --session-id=codex-1
```

## Hook propagation

Currently the harness hooks live in **`.claude/settings.local.json`** (untracked, machine-local) for one dry-run cycle. Promotion to tracked `.claude/settings.json` happens after the dry-run proves no loops, leaks, or wrong-path writes.

Codex managed sessions get the same hooks via `tools/codex/lib/hook-emulation.js`, which calls the same `coordination-dispatcher.js` script with appropriate env vars (`MYTHOS_HOOK_EVENT`, `MYTHOS_HOOK_SOURCE=codex-managed-runtime`, etc.).

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

Edit `_dev/state/active-sessions/_ttl-policy.json` to tune. Defaults:

| Actor type | TTL | Heartbeat |
|---|---|---|
| claude-opus-4-7 / sonnet-4-6 | 30 min | every 2-5 min |
| claude-haiku-4-5 | 15 min | every 2 min |
| codex-managed | 20 min | every dispatch |
| kerneling-rupert-worker | 15 min | every loop |
| scheduled-job | 2× expected interval | at start + end |
| ci-shortjob | 10 min | start + halfway |
| long-daemon | 60 min | every 5 min |
| background-agent | 15 min | each tool round |

## Coordination integration

- **HandoffSignal/2.0 schema validator:** `tools/verify/lib/signal.cjs` (`validateHandoffSignalV2`)
- **Lifecycle helper:** `tools/signals/lib/signal-lifecycle.js` (`stampAcknowledgement`, `completeIfSatisfied`, `runOnComplete`)
- **Live signal scanner + driver:** `tools/signals/lib/live-signal-scanner.js`, `signal-lifecycle-driver.js`
- **Schema doc:** `tools/signals/coordination-signal-schema.md`
- **Concept:** `_dev/concepts/active-session-signal-awareness-and-work-claim-hook.md`

## Tests

```bash
node --test \
  tools/sessions/lib/__tests__/active-session-registry.test.js \
  tools/sessions/hooks/__tests__/coordination-dispatcher.test.js \
  tools/signals/lib/__tests__/live-signal-scanner.test.js \
  tools/signals/lib/__tests__/signal-lifecycle-driver.test.js \
  tools/signals/lib/__tests__/signal-lifecycle.test.js \
  tools/verify/lib/__tests__/coordination-signal-2.0.test.cjs \
  tools/codex/lib/__tests__/hook-emulation.test.js
```

Last green: 85 pass, 1 skip (TODO — node:test runner hang on combined-suite mock-injection cleanup), 0 fail across all 7 files. Branch `feat/multi-session-coordination`.

## Deferred

- Promote `.claude/settings.local.json` hooks to tracked `.claude/settings.json` after one dry-run cycle.
- Migrate the two pre-existing `HandoffSignal/1.0` signals (`__20260427T160000Z`, `__20260427T161500Z` on `fleet-onto-dev-workspace`) to 2.0 schema.
- Resolve quorum mode for `target_addressees.mode = "all-active"` (registry resolver wiring against `listActive`).
