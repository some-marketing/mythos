# Lessons — session-learning reconciliation

The lessons loop turns scattered same-day session-learnings notes into a
periodically reconciled, durable record — and routes the actionable items
that come out of reconciliation into whatever intake process your guild
uses, without silently promoting anything to durable law.

## `scan-session-data.js` + `lib/session-scan.js` — working, ported as-is

Scans `_dev/reports/analysis`, `_dev/concepts`, `clients`, and `tools` for
same-day artifacts relevant to a reconciliation pass: session-learnings
files, run-debriefs, improve/replicate plans, prior reconciliation
artifacts, concept docs, and tooling changes. Classifies each into a
primary or supporting bucket by filename convention, matches against a
target date (by filename date or file mtime), and writes both a JSON and a
Markdown scan report.

```
node tools/lessons/scan-session-data.js                 # scan today
node tools/lessons/scan-session-data.js --date latest    # scan the most recent relevant date
node tools/lessons/scan-session-data.js --project <substr> --json
```

This one has no private dependencies — it's pure filesystem classification
logic — so it ported working, unchanged in behavior.

## `check-reconciliation-due.cjs` — STUB

The original depended on a private auto-run/signals stack (a specific
harness's auto-run status reader, tied to the same private coordination
contract used elsewhere in this port). This ships as a self-contained stub
instead: due if it's been more than 7 days since the last
`lessons-reconciliation__*.md` artifact, or if 5+ session-learnings files
have accumulated since then. Replace `getReconciliationStatus()` with your
own real cadence or signal logic once you have one — the rest of the file
(the CLI, the JSON/text output shape) doesn't need to change.

```
node tools/lessons/check-reconciliation-due.cjs         # status only
node tools/lessons/check-reconciliation-due.cjs --json
```

## `route-reconciliation-intake.cjs` — working, with one guarded dependency

Parses `lessons-reconciliation__<date>.expectation-failures.json`
artifacts, collects findings marked `actionable` that haven't been routed
before, and writes an intake handoff document
(`_dev/reports/analysis/lessons-intake__current.md`) plus routing state at
`_dev/state/lessons-reconcile/routed.json` (idempotent re-runs). This core
logic has no private dependencies and works as ported.

The one external touchpoint — dropping a session-boundary marker so the
next session inherits the intake items as current state — calls
`tools/sessions/write-boundary.cjs` if that script exists in your repo.
If it doesn't (e.g. you haven't ported or built session-boundary tooling
yet), this step is skipped with a clear note in the output rather than
failing; the handoff document is still written either way.

```
node tools/lessons/route-reconciliation-intake.cjs [--json] [--dry-run]
```

This tool doesn't post to any task tracker itself — it lists the items
needing tracker tasks in the handoff document. Wire your own
task-creation step to read that document and mark items
`routed_to_tracker` once posted.
