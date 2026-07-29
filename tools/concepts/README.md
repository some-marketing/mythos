# Concepts tooling

Two self-contained tools for working with `_dev/concepts/` — the concept
inventory (idea backlog) that feeds `/inscribe-lore` and `/charter-quest`.

## `inventory-concepts.cjs`

Walks `_dev/concepts/`, classifies every concept record by category and
priority using generic keyword rules, cross-references it against
`_dev/reports/analysis/task-plans/`, and produces a full routing report:
which concepts already have an owner plan, which need a brand-new
`/plan-task`, which should be reviewed for closure/supersession, and a
priority-ordered fanout runbook a coordinator can execute batch by batch.

```
node tools/concepts/inventory-concepts.cjs
```

This writes into `_dev/reports/analysis/concept-inventory/` and
`_dev/reports/analysis/task-plans/`:

- `mythos-concepts-inventory.{json,md}` — the full classified inventory
- `concept-child-plan-queue.{json,md}` — concepts grouped by owner plan / new-plan / cluster
- `<parent-plan-id>__plan.{json,md}` — a parent `TaskPlan/1.0` ordering the whole fanout
- `concept-fanout-runbook.{json,md}` — priority-ordered execution batches with ready-to-run prompts
- `concept-fanout-status.{json,md}` — live status of each batch, read from existing review/amendment artifacts
- one `<cluster-id>-concept-cluster__plan.{json,md}` per P1 cluster
- one `<owner-plan-id>__amendment__<ts>__concept-inventory-fold.{json,md}` per owner-plan fold

**This ships with zero routing data baked in.** The category/priority
classification rules are generic keyword patterns (continuity, governance,
orchestration, planning-visibility, harness-runtime, memory-retrieval,
compute-infrastructure, frameworks, client-delivery, voice-interface,
design-surface, world-modeling) and work against any `_dev/concepts` tree.
But the semantic-owner routing table (which concept slugs fold into which
existing owner plan) and the closure/supersession notes are entirely your
own guild's data — the tool loads them from an optional sibling config file,
`inventory-concepts.config.json`, which does not exist until you create it.

Copy `inventory-concepts.config.example.json` to
`inventory-concepts.config.json` and fill in your own:

- `parent_plan_id` — the task id for the generated parent plan (default: `concept-program-inventory-and-implementation-order`)
- `memory_mirror_root` — an optional second concepts tree to treat as a read-only mirror/source (e.g. a separate memory-mirror repo checked out as a sibling); `null` disables it, which is the default
- `semantic_owner_rules` — regex-pattern-to-owner-plan routing entries (empty by default)
- `closure_review_rules` — regex-pattern-to-closure-reason entries (empty by default)
- `owner_group_priority_order` — a display-order preference for owner-plan groups; unlisted plans sort by priority then name
- `reviewer_actor_id` / `reviewer_harness_id` — the identity recorded on generated amendment artifacts when a distinct-family reviewer is the one folding a concept into an owner plan (defaults: `distinct-family-reviewer` / `external-cli`)

Without a config file, the tool still runs correctly — it just won't route
any concept to an existing owner plan (every outstanding P0/P1 concept comes
back as `needs-plan-task` until you teach it your own routing table).

## `recover-btw.js`

Recovers `/btw` (or bare `btw`) capture markers from Claude Code session
transcripts. Scans `~/.claude/projects/<project>/*.jsonl`, finds every user
turn that starts a `/btw` capture, pairs it with the assistant response that
immediately follows, and writes one Markdown file per pair into
`_dev/concepts/_recovered/` with full session/turn provenance. Idempotent —
re-runs skip pairs already indexed.

```
node tools/concepts/recover-btw.js              # scan + write
node tools/concepts/recover-btw.js --dry-run    # report only, no writes
node tools/concepts/recover-btw.js --since 2026-04-01
node tools/concepts/recover-btw.js --all-projects
```

By default it scans only the Claude Code project directory that corresponds
to the current working directory — derived from the cwd itself (Claude Code
names each project's transcript directory after the absolute path with
separators replaced by dashes), not a hardcoded path. `--all-projects` scans
every project directory Claude Code has ever recorded.
