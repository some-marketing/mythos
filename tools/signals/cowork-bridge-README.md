# Cowork → Desktop Claude Code → Codex bridge

This README covers installation, operation, and troubleshooting of the
desktop-codex variant of `/dispatch-bridge`. For the design rationale,
read `_dev/cowork-sessions/dispatch-bridge-cowork-variant.md`.

## What's in this folder

```
tools/signals/
├── cowork-orchestrator-bridge.js   # Cowork-side: writes packets, polls verdicts
├── desktop-cowork-consumer.sh      # Desktop-side: consumed by launchd
└── cowork-bridge-README.md         # this file
```

The packet directories live under `_dev/reports/signals/`:

```
_dev/reports/signals/
├── cowork-out/      # Cowork writes here; launchd watches this dir
├── cowork-in/       # consumer writes verdict here; Cowork polls this dir
└── cowork-archive/  # consumed packets, kept forever for forensic replay
```

## Install — the single user action

The portable service catalog resolves every path from the current repository.
After reviewing the host activation manifest, install this service with:

```bash
tools/launchd/install.sh cowork-bridge
```

To stop it without deleting repository state:

```bash
launchctl bootout "gui/$(id -u)/org.mythos.portable.cowork-bridge"
```

The installer renders a concrete plist from `tools/launchd/services.json`,
backs up any installed plist, and records a rollback receipt under ignored
local state.

## Verify the install

```bash
launchctl print "gui/$(id -u)/org.mythos.portable.cowork-bridge" | head -40
ls -la _dev/state/launchd/cowork-bridge/
```

A successful install shows `state = running` and an empty log dir (the dir
is created on first packet).

## Daily use — Cowork side

From any Cowork session:

```bash
# Bridge a real verification request and wait for codex's verdict.
node tools/signals/cowork-orchestrator-bridge.js submit \
    --task "Verify the change to client-routing.json" \
    --command /cross-verify-claim \
    --target codex \
    --context "clients/_active/client-routing.json" \
    --scope-tag verify-client-routing \
    --json

# Bridge but don't wait — useful for fire-and-forget patterns.
node tools/signals/cowork-orchestrator-bridge.js submit \
    --task "..." --command /... --no-wait

# Mark the call as routine. By default this still bridges. Routine bypass
# is opt-in only — pair --routine with --allow-routine-bypass (or set
# SMOS_COWORK_BRIDGE_BYPASS=1) to skip the bridge for greetings/pings.
node tools/signals/cowork-orchestrator-bridge.js submit \
    --task "are you there" --routine --allow-routine-bypass
```

Or import as a library:

```js
const { submitRequest } = require('./tools/signals/cowork-orchestrator-bridge');

const result = await submitRequest({
  task_summary: 'Verify the change to client-routing.json',
  target_command: '/cross-verify-claim',
  target_actor: 'codex',
  context_files: ['clients/_active/client-routing.json'],
  scope_tag: 'verify-client-routing'
});

// `bypassed: true` only happens when the caller explicitly opted into
// routine bypass (dryRunOnRoutineMessages / SMOS_COWORK_BRIDGE_BYPASS /
// --allow-routine-bypass). The default always bridges.
if (result.bypassed) console.log('routine — bypass opt-in took effect');
else console.log(`codex verdict: ${result.verdict.verdict.summary}`);
```

## Daily use — Desktop side

The launchd plist runs the consumer automatically. To run it manually
(for debugging, or when you've copied a packet by hand):

```bash
# Process every packet currently sitting in cowork-out/.
bash tools/signals/desktop-cowork-consumer.sh

# Process a specific packet.
bash tools/signals/desktop-cowork-consumer.sh \
    --packet _dev/reports/signals/cowork-out/<filename>.cowork-request.json

# Round-trip wire-protocol test (no claude/codex calls).
bash tools/signals/desktop-cowork-consumer.sh --simulate
```

Logs go to `_dev/logs/cowork-bridge/`:

```
_dev/logs/cowork-bridge/
├── consumer-YYYYMMDD.log              # one line per packet processed
├── launchd.stdout.log                 # plist-captured stdout
├── launchd.stderr.log                 # plist-captured stderr
├── <packet-base>.stdout.log           # claude headless stdout per packet
└── <packet-base>.stderr.log           # claude headless stderr per packet
```

## Scope rule: when to bridge

**Literal always-bridge default.** The bridge routes every output through
the desktop consumer — both consequential outputs (plans, file writes,
loop-closures) AND routine conversational ticks (greetings, pings, acks).
This is set in `cowork-orchestrator-bridge.js#DEFAULTS`:
`dryRunOnRoutineMessages: false`.

Routine bypass is opt-in only. Three ways to enable for a given session:

- Per-submit: `submitRequest(input, { dryRunOnRoutineMessages: true })`
- Process env: `export SMOS_COWORK_BRIDGE_BYPASS=1`
- CLI flag: `--allow-routine-bypass` on the `submit` subcommand

When bypass is enabled, only inputs matching the narrow `isRoutine()`
allowlist (greetings, acknowledgments, pings) actually short-circuit;
anything else still bridges.

The full rule, including which Cowork outputs count as consequential,
lives in `_dev/cowork-sessions/dispatch-bridge-cowork-variant.md`
(section *"Scope rule"*). The skill file at
`.claude/skills/cowork-orchestrator-bridge/SKILL.md` is the operator
contract Cowork sessions load on session start.

## Cleanup

The `cowork-archive/` dir grows by one file per bridged request. To keep
it bounded:

```bash
# Move archive entries older than 30 days to a tarball, then delete.
find _dev/reports/signals/cowork-archive -name '*.cowork-request.json' \
     -mtime +30 -print | tar -czf cowork-archive-$(date +%Y%m).tar.gz -T -
find _dev/reports/signals/cowork-archive -name '*.cowork-request.json' \
     -mtime +30 -delete
```

## Troubleshooting

**`status: timeout` from submitRequest.** Desktop consumer didn't run in
the timeout window. Check `_dev/logs/cowork-bridge/launchd.stderr.log`.
Most common cause: laptop was asleep. Packet stays in `cowork-out/`; will
resolve when the laptop wakes and launchd re-evaluates WatchPaths.

**`status: consumer_error, exit_code: 127`.** The consumer ran but couldn't
find `claude` on PATH. Edit the `EnvironmentVariables.PATH` block in the
plist, or symlink `claude` into `/usr/local/bin/`.

**`status: dispatch_failed`.** `claude` ran but `/dispatch-bridge` exited
non-zero. Read the consumer's stderr log for that packet to see what
target-command-policy.cjs or the codex runner rejected.

**Two simultaneous packets, only one verdict.** That's a bug — the
consumer's `process_packet` loop should iterate every file in cowork-out/.
File a defect with the `consumer-YYYYMMDD.log` attached.

## Security notes

- The packet's `prompt_body` is treated as data: the consumer pipes it
  into `claude` headless's stdin. It is never `eval`-ed, never passed as
  a bash argument, and never expanded.
- The only thing the consumer actually executes is `claude -p`. Everything
  else (the slash command, the codex call) goes through the existing
  `dispatch-bridge.js` validator chain (`target-command-policy.cjs`,
  `paste-target-prompt.cjs`).
- The launchd plist is loaded into `gui/$(id -u)`, your user agent — not
  `system/`. It runs as you, with your file permissions, never as root.
- The Cowork sandbox cannot invoke the consumer, only write packets. If
  the desktop is offline, packets sit in `cowork-out/` until you bring
  it online. There is no remote execution surface.
