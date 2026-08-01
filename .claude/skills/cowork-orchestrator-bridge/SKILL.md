---
name: cowork-orchestrator-bridge
description: |
  Operator contract for routing Cowork outputs through the desktop Claude Code
  → /dispatch-bridge → codex chain. Loaded on Cowork session start whenever
  the always-be-bridging discipline is in effect. Defines what gets bridged,
  what doesn't, and how to invoke the bridge.
---

# cowork-orchestrator-bridge

This skill is the operator-facing contract for the desktop-codex variant of
`/dispatch-bridge`. It tells a Cowork session three things: when it MUST
bridge, when it MUST NOT, and how to actually call the bridge.

## What this is

Cowork (the conversational surface in this Anthropic environment) cannot
shell out to `codex exec`, cannot read the user's keychain, and cannot
mutate the trusted desktop working tree atomically. The user's desktop
Claude Code installation can do all three. This skill bridges Cowork's
outputs through the desktop, so every consequential Cowork output is
cross-verified by codex (a different intellect with different priors)
before it lands.

The mechanical chain (file paths and contracts):

- Cowork side: `tools/signals/cowork-orchestrator-bridge.js submit ...`
- IPC: `_dev/reports/signals/cowork-out/` (request) and
  `cowork-in/` (verdict) and `cowork-archive/` (consumed packets)
- Desktop side: `tools/signals/desktop-cowork-consumer.sh` invoked by
  the registered `cowork-bridge` entry in `tools/launchd/services.json`
  (render or install it with `tools/launchd/install.sh cowork-bridge`)
- Desktop runs `claude` headless → `/dispatch-bridge --target codex --run-now`
- Codex's verdict is wrapped into a verdict packet and read back by Cowork

The full design is in `_dev/cowork-sessions/dispatch-bridge-cowork-variant.md`.

## When this skill is in effect

Always — once the user has loaded the launchd plist on their desktop. The
user's "always be bridging" doctrine means every consequential Cowork
output is cross-verified through codex before being treated as load-
bearing. This skill defines "consequential."

## Scope: what to bridge

**Every consequential and routine output bridges by default. Bypass requires
explicit opt-in.**

This is the literal always-bridge default. Both load-bearing outputs (plans,
synthesis, file writes, loop-closes) AND conversational ticks (greetings,
pings, acknowledgments) flow through `submitRequest` to the desktop consumer
and back through codex. There is no longer a default-on routine classifier.

The categories below are kept as conceptual anchors — they describe what
*kinds* of output exist, not which ones bypass the bridge.

### Consequential outputs (always bridge)

A Cowork output is **consequential** if any of these is true:

- It's a plan, recommendation, or synthesis the operator might act on
- It's closing a loop, declaring a slice complete, or marking a task done
- It writes into canonical files, frameworks, skills, signals, or memory
- It edits client data, framework manifests, or guardrails
- It asks the operator to confirm a destructive, irreversible, or
  externally-visible action (ship, delete, send, share)
- The operator explicitly asked for cross-verification on this turn

For these, call `submitRequest` and wait for the verdict before letting
the output leave the orchestrator. If the verdict comes back `dispatch_failed`
or `timeout`, surface the unverified state honestly — don't paper over it.

### Routine outputs (also bridge by default)

A Cowork output is **routine** if it's:

- A greeting, acknowledgment, or courtesy reply ("hi", "thanks", "noted")
- A status ping ("are you there", "how's it going")
- A pure information lookup using inline context (no decision attached)
- A dry-run preview the operator hasn't asked to land
- A turn that produces no output the operator might act on (e.g., asking
  the operator a clarifying question)

These now bridge by default too. The previous heuristic classifier
`isRoutine()` is preserved in `tools/signals/cowork-orchestrator-bridge.js`
but is no longer consulted on the default path — only when the caller
explicitly opts into routine bypass.

When in doubt about consequential vs. routine: it doesn't matter for the
default path; both bridge. The distinction only matters if you have opted
into routine bypass for a specific session/operator workflow.

### Routine-bypass opt-in

If the latency tradeoff matters for a specific session (e.g. a
high-frequency conversational interface where every greeting costs a
codex round-trip), routine bypass can be enabled three ways:

- **Per-submit:** pass `dryRunOnRoutineMessages: true` in the `opts` arg
  to `submitRequest`.
- **Process-wide env:** export `SMOS_COWORK_BRIDGE_BYPASS=1`. Routine
  messages then short-circuit to a synthesized `bypassed_routine`
  verdict for the lifetime of the process.
- **CLI flag:** `--allow-routine-bypass` on the `submit` subcommand.

In all three cases the `isRoutine()` classifier is then consulted; only
inputs matching its narrow allowlist (greetings, acks, pings) are
bypassed. Anything else still bridges.

## How to invoke from a Cowork session

### From a shell

```bash
node tools/signals/cowork-orchestrator-bridge.js submit \
    --task "<one-paragraph task summary for codex>" \
    --command "/<exact-slash-command>" \
    --target codex \
    --context "path/relative/to/repo,other/path.json" \
    --scope-tag <kebab-case-scope> \
    --json
```

The command writes a packet, blocks polling `cowork-in/`, and returns
the codex verdict (or `timeout`). Use `--no-wait` if you want fire-and-
forget; use `--routine` to force a bypass; use `--timeout-ms` to
override the default 10-minute window.

### From JS

```js
const bridge = require('./tools/signals/cowork-orchestrator-bridge');

const result = await bridge.submitRequest({
  task_summary: 'Verify the change to client-routing.json',
  target_command: '/cross-verify-claim',
  target_actor: 'codex',
  context_files: ['clients/_active/client-routing.json'],
  scope_tag: 'verify-client-routing'
});

if (result.bypassed) {
  // routine — proceed locally
} else if (result.verdict.status === 'ok') {
  // codex's verdict is in result.verdict.verdict.summary
} else if (result.verdict.status === 'timeout') {
  // surface "unverified — desktop offline" to operator, do not auto-land
} else {
  // dispatch_failed or consumer_error — surface honestly
}
```

## Required behaviors when consuming the verdict

- **`ok`**: the codex verdict is in `result.verdict.verdict.summary`. Treat
  it as a second-opinion review, not as ground truth. If codex disagrees
  with Cowork's draft, surface both views — don't flatten.
- **`bypassed_routine`**: proceed locally; this was a courtesy reply.
- **`timeout`**: the desktop didn't respond inside the window. The packet
  remains in `cowork-out/` and will resolve when the desktop wakes. Tell
  the operator: "verdict pending; desktop appears offline; reference
  packet at `<path>`." Do not declare the output verified.
- **`dispatch_failed`**: claude ran but dispatch-bridge rejected the
  request. Read the verdict's `stderr_tail` and surface the concrete
  blocker.
- **`consumer_error`**: the consumer couldn't run at all (claude not on
  PATH, etc.). Surface honestly; suggest the user check
  `_dev/logs/cowork-bridge/`.

## Failure modes to watch for

- **Self-approval**: do NOT bridge through `target_actor: claude` for
  cross-verification. Same-actor verification is echo, not verification.
  Use `codex` (default) or `gemini` for cross-verification.
- **Drift dressed as warmth**: don't classify a load-bearing recommendation
  as routine because it was phrased conversationally. Look at what the
  output is *doing*, not how it's worded.
- **Skipping the verdict**: if the codex verdict comes back disagreeing
  with the Cowork draft, do not silently override. Hold the contradiction
  visible to the operator.

## Source-of-truth references

- Design rationale: `_dev/cowork-sessions/dispatch-bridge-cowork-variant.md`
- Install + ops: `tools/signals/cowork-bridge-README.md`
- Existing `/dispatch-bridge` contract: `.claude/commands/dispatch-bridge.md`
- Canonical YAML: `instructions/canonical/commands/dispatch-bridge.yaml`
- Library source: `tools/signals/cowork-orchestrator-bridge.js`
- Consumer source: `tools/signals/desktop-cowork-consumer.sh`
- Grounding card: `_dev/cowork-sessions/cowork-grounding-card.md`
  (Cross-Verification Law, Cost-Effective Intellect Calls)
