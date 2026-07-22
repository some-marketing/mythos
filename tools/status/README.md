# status/

Two independent status tools.

## `status.js` — consolidated operator status (scaffold)

```
node tools/status/status.js [--json]
```

Aggregates: live signals (via `tools/signals/signal-lane.cjs`), closeout
readiness (via `tools/maintenance/end-session-closeout.js`), and a plain
filesystem inventory (framework categories, commands, skills).

This is a **rewrite**, not a straight port. The source this pattern came from
aggregated across many more systems — a next-step decision-tree resolver, a
task-plan resolver, a maintenance-topology scout, a harness-capability
dashboard, a Dart project-management integration, and (concerningly) a
hardcoded read of one specific real client's live-ads tracker file. None of
that machinery ships here, and porting a status tool with half its imports
broken would be worse than useless. So this version only aggregates over
what's actually shipped in this tree today: the signals lane and the
closeout stub. Extend it as you ship more of your own tooling — each new
section should read from a real, checked-in module, never a hardcoded path
into one specific client's data.

## `bridge-status.js` — bridge lifecycle observability

Self-contained, no dependencies on anything else in this tree. Reads
`_dev/state/bridge-state.json` (a map of scope → lifecycle state, if you
have one) and produces `BridgeStatus/1.0` snapshots to
`_dev/reports/signals/`. Ships with its schema
(`bridge-status.schema.json`). Useful if you build your own
multi-actor-dispatch tracking on top of the signals lane — this is a
worked example of one way to summarize that state over time, not a
requirement.

## What's not here

The original source's test suite tested the old, deeply-coupled status
module and doesn't apply to this rewrite — not ported. If you extend
`status.js`, write new tests against its actual (much smaller) surface.
