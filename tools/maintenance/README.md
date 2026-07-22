# Maintenance — closeout pattern + shared receipt writer

## The end-session-closeout pattern

`end-session-closeout.js` ships as a **minimal working stub**, not the
operator's full private implementation. The real version this was
distilled from is deeply coupled to a private multi-actor coordination
contract — a specific signal schema, a "planned vs. operational session"
classifier, per-actor pending-action routing (which reviewer owes what),
and launchd-scheduled wiring. None of that has shipped here, so rather than
port a half-working copy that imports libraries that don't exist, this
scaffold ships the reusable shape underneath all of that: a read-only
summary builder that inventories your own repo's durable artifacts and
live signal files, and tells you whether it's safe to end the session.

The pattern, in four steps:

1. **Inventory durable artifacts** for the scope you're closing (debriefs,
   handoffs, whatever your own naming convention produces under
   `_dev/reports/analysis/`).
2. **Read live pending signals** — whatever your own signal/coordination
   mechanism writes under `_dev/reports/signals/`.
3. **Derive `ready_for_clear`** — a boolean gate, true only when there are
   no live pending signals blocking the scope and the artifact inventory
   isn't empty.
4. **Write a durable JSON + Markdown summary**, so the decision is
   inspectable and grep-able later, not just a console message that
   scrolled away.

To make this genuinely yours: replace `inventoryArtifacts()` and
`readLiveSignals()` in `end-session-closeout.js` with whatever your own
guild's real artifact-naming and signal-schema conventions are. Wire it to
whatever signal system, launchd job, or session-boundary tooling your own
guild builds — the `buildCloseout()` / `writeCloseout()` shape around those
two functions doesn't need to change.

```
node tools/maintenance/end-session-closeout.js --scope <name> [--json]
```

## `lib/hygiene-lane-health.cjs` — shared lane-health receipt writer

This one ported as-is; it's already fully generic. Any self-healing or
apply-mode tool (a rotation lane, a repair lane, a reconciliation lane)
appends one durable receipt here every time it makes an apply-mode
decision: what tool decided what, on what evidence, with what outcome.
Append-only JSONL at `_dev/reports/lifecycle/hygiene-lane-health.jsonl`,
schema `HygieneLaneHealth/1.0`. This is what `tools/state/rotate-jsonl.cjs`
uses to record every rotation it performs — see that tool for a live
example of the writer in use.

```js
const { appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs');
appendReceipt({ tool: 'your-tool-name', decision: 'did-the-thing', target: 'whatever-it-acted-on', outcome: 'success' });
```
