# JSONL rotation

A WAL-style size/age rotator for append-only `_dev/state/**/*.jsonl` logs.
These logs grow without bound as long as something appends to them; this
tool rotates each one like a write-ahead log — the cold prefix (oldest
lines) is split off, gzipped into a dated archive location, and the live
file is rewritten with only its recent, readable tail. Recent history stays
plain-text and grep-able in place; cold history is preserved compressed,
never deleted.

## Run

```
node tools/state/rotate-jsonl.cjs                 # dry-run (default) — prints the plan, mutates nothing
node tools/state/rotate-jsonl.cjs --apply         # actually rotate
node tools/state/rotate-jsonl.cjs --surface <rel> # limit to one surface
node tools/state/rotate-jsonl.cjs --verbose
```

## Why it's safe

- **Default dry-run.** Mutation requires the explicit `--apply` flag.
- **Non-interactive safe.** Never prompts, never reads stdin — safe to run from a scheduled task.
- **Kill-switch.** Create `_dev/state/rotate-jsonl/disabled` and the tool exits 0 without touching anything, even under `--apply`.
- **Idempotent.** Rotation always leaves at least `keep_tail_lines` recent lines in the live file. Re-running over an already-rotated surface is a no-op.
- **Never deletes.** The only mutation is (gzip cold prefix → archive) then (atomically rewrite the live file with the tail — write to a temp file, rename over the original only after the archive is durable).
- **Explicit coverage.** Every `_dev/state` JSONL surface is either covered by a policy, listed as a documented exemption, or reported as UNCLASSIFIED and left untouched — so a new writer surfaces loudly instead of silently growing forever.

## Configuring your own surfaces

Edit the `CONFIG` object at the top of `rotate-jsonl.cjs`:

- `defaults` — `max_bytes` (size trigger), `keep_tail_lines` (hard floor of recent lines never cut), `max_age_days` (age trigger, based on a `ts`/`timestamp`/`time`/`date`/`at`/`created_at`/`createdAt` field in each line).
- `surfaces` — glob patterns (repo-relative) that get rotated, with optional per-surface overrides of the defaults.
- `exemptions` — glob patterns that are never rotated, each with a documented reason (exemptions take precedence over surfaces).

Every `--apply` rotation appends one receipt to
`_dev/reports/lifecycle/hygiene-lane-health.jsonl` via the shared writer in
`tools/maintenance/lib/hygiene-lane-health.cjs` — see that file's own
README section for the receipt shape.
