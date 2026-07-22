# Signals — the `HandoffSignal` family

A **signal** is a structured, durable JSON handoff between actors — a work-unit
report that says "the work is at state X, here is the evidence, here is what
should happen next" without either actor having to re-derive that from chat
history or from another actor's private memory. Chat context does not cross
actor or session boundaries reliably; a signal file does.

This directory ships the schema layer for a signal family we call
**`HandoffSignal`** (any name works — pick one and use it consistently; the
important part is that it is a durable, versioned, machine-checkable contract,
not a prose note). Each schema below is one *type* of `HandoffSignal`, scoped
to a specific point in the handoff lifecycle.

This is an architecture scaffold: the 7 schemas plus a minimal single-file
reference lane implementation (`signal-lane.cjs`). It is **not** a port of a
full production signals pipeline (bridge runners, watchers, actor registries,
normalization daemons, etc.) — those are deliberately out of scope here. Treat
this as the pattern to study and extend, not a finished subsystem.

## What a signal is (and isn't)

- A signal **is** a self-contained JSON file with a `schema` field naming its
  exact type and version (e.g. `"ActorWorkOrder/1.0"`), written to a shared
  filesystem location so any actor with read access can pick it up.
- A signal **is not** a message in a chat transcript, a comment in an issue
  tracker, or an in-memory object passed between function calls in the same
  process. Its value comes from surviving past the lifetime of the
  conversation or process that created it.
- A signal is **advisory to the receiving actor's judgment, not a replacement
  for it** — receiving a signal doesn't obligate blind execution; the actor
  still evaluates the work against its own constraints.

## Lifecycle: emit -> live -> consumed/closed -> archived

This mirrors the lifecycle already documented for this workshop in
`_dev/policies/data-handling.md` ("Handoff Signal Lifecycle" section) and the
convention already used at `_dev/reports/signals/`:

1. **Emit.** An actor produces a signal (one of the schema types below),
   validates it against the schema's required fields, and writes it as a JSON
   file into the live surface: `_dev/reports/signals/`.
2. **Live.** While the file sits in `_dev/reports/signals/`, it represents
   actionable state — a pending work order, a receipt awaiting review, a
   failure decision awaiting escalation. Only files in the live surface should
   influence what the next actor or next command does. Keep this surface
   small: a signal that lingers here after being read is stale state
   pretending to still be live.
3. **Consumed / Closed.** Once the receiving actor has read and acted on the
   signal, it is closed: moved from `_dev/reports/signals/` to
   `_dev/reports/signals/closed/`, with `lifecycle_state: "closed"` and a
   `closed_at` timestamp added to the JSON. The original signal content is
   preserved untouched alongside those two added fields — closing is additive,
   not destructive.
4. **Archived.** Closed signals age out under normal retention rules (this
   scaffold does not implement archival — see `_dev/policies/data-handling.md`
   for the retention convention this repo already documents elsewhere).

```
emit --> _dev/reports/signals/            (live)
              |
              | actor consumes it, acts on it
              v
close --> _dev/reports/signals/closed/    (closed, lifecycle_state + closed_at added)
              |
              | (out of scope for this scaffold)
              v
          archive
```

## The 7 schema types and where each fits in the lifecycle

| Schema (`schema` field) | File | Role in the lifecycle |
|---|---|---|
| `ActorWorkOrder/1.0` | `schemas/actor-work-order.schema.json` | The initial handoff: one actor assigns a bounded unit of work to another. Carries continuity (current state / question-work / desired state), which actor/model/mind is targeted, the execution mode, custody scope, privacy/disclosure posture, and a retry ceiling. This is what gets emitted to *start* a handoff. |
| `ActorCapabilityReceipt/1.0` | `schemas/actor-capability-receipt.schema.json` | The receiving actor's acknowledgment: references the work order it is responding to (by content hash), reports readiness checks, and flags any errors before real work begins. This is a receipt, not a result — it answers "can I actually do this?" before the actor commits to doing it. |
| `ActorFailureDecision/1.0` | `schemas/actor-failure-decision.schema.json` | Emitted when a dispatched actor fails. Classifies the failure (timeout, auth, permission, safety, semantic, etc.), records the attempt count against the work order's retry ceiling, and states a disposition — retry the same target, stop terminally, or escalate to the coordinator. This is what keeps a failed handoff from silently vanishing. |
| `NextPromptPacket/1.0` | `schemas/next-prompt-packet.schema.json` | A structured "what to hand the next actor" packet spanning worker, reviewer, bridge, closeout, handoff, and systemization-init roles. Bundles write-set/forbidden-surfaces scoping, expected evidence, tests, review lane, closeout owner, and a grounding posture, plus an embedded work-order summary and an exact return contract the next actor must fill in. This is the "next step" signal a coordinator hands forward. |
| `RecursiveActorWorkOrder/1.0` | `schemas/recursive-actor-work-order.schema.json` | A compact work order shaped for recursive child delegation — a parent scope handing a bounded slice to a child scope, with its own routing/transport/model-class selection, an aggregation contract for merging child results back up, and stop conditions. This is what makes the pattern fractal: any actor holding one of these can decompose its own assignment into further `HandoffSignal`s. |
| `SignalAuthorityDecision/1.0` | `schemas/signal-authority-decision.schema.json` | A gate decision over a signal: given a signal's content hash and requested scope, records whether it is eligible, blocked, or needs review, which checks passed or failed, and whether capability was actually granted. This is the authority check that runs before a signal is allowed to drive an action. |
| `SignalNormalizationProposal/1.0` | `schemas/signal-normalization-proposal.schema.json` | A proposal to change a signal's disposition during surface cleanup — close it, mark it duplicate/superseded, or flag it for review — carrying the authority decision that justified the proposal and an evidence trail. This is what keeps the live surface small over time without ad hoc, unlogged deletions. |

Read together: a work order starts a handoff, a capability receipt confirms
the receiving actor can act on it, a failure decision handles what happens
when it can't, a next-prompt packet or recursive work order carries the
result forward (linearly or by further decomposition), and the authority
decision / normalization proposal pair govern how signals get retired from
the live surface. All seven are members of the same `HandoffSignal` family —
they share the discipline of a required `schema` field, explicit required
fields, and `additionalProperties: false` — even though each has a distinct
shape for its distinct point in the lifecycle.

## The reference stub

`signal-lane.cjs` in this directory is a minimal, self-contained (Node
builtins only) reference implementation of the live/closed lifecycle above:
`emitSignal`, `listSignals`, `closeSignal`. It is intentionally small — a few
dozen lines per function — and is meant to be read and extended, not treated
as a finished pipeline. See the file's own comments and
`__tests__/signal-lane.test.cjs` for usage.

## What this scaffold deliberately does not include

- Bridge runners or watchers that dispatch signals to real external actors
  (no `run-*-bridge.js`, no `watch-*.js`).
- An actor registry or transport-selection policy.
- Automatic archival, retention enforcement, or a normalization daemon.
- Any authority-decision or normalization-proposal *engine* — the schemas for
  those signal types ship here, but nothing in this directory evaluates or
  emits them yet. That's an extension point.
