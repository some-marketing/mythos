# 05 — Task Formatting

## Purpose

Compile all audited and flagged feedback into a structured task list with provenance citations, authority-based priority, and ambiguity annotations. Produce the final deliverables: TASK_LIST.md and task_compilation_summary.json.

## Execution Mode

**PATCH_ALLOWED** — Generate task list files, present for review, and finalize.

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `communication_architecture.json` | artifact | Yes | Stakeholder roles, scope boundaries, output format config |
| `raw_feedback.json` | artifact | Yes | Original fetched feedback |
| `provenance_audit.json` | artifact | Yes | Provenance records for all items |
| `ambiguity_flags.json` | artifact | Yes | Identified ambiguities and clarification needs |
| `destination_format` | string | Yes | From architecture: `markdown`, `json`, or `github-issues` |
| `task_prefix` | string | No | Prefix for task IDs (e.g., `CLIENTB`) |

## Process

### Step 1: Load All Prior Artifacts [AUTO]

Read all four input artifacts from `task_output/`:
- `communication_architecture.json`
- `raw_feedback.json`
- `provenance_audit.json`
- `ambiguity_flags.json`

Verify all artifacts are present and valid. If any are missing, report and stop.

### Step 2: Generate Task List [AUTO]

For each feedback item with `complete` or `partial` provenance, generate a task entry:

| Field | Description |
|-------|-------------|
| `task_id` | Sequential ID with prefix: `{PREFIX}-001`, `{PREFIX}-002`, etc. |
| `title` | Short descriptive title — what to review, NOT what to do |
| `description` | Expanded description preserving stakeholder's original wording |
| `provenance` | Full citation: "Feedback by [Author] ([Role]) on [Item] at [Timestamp]: '[exact quote]'" |
| `source_url` | Direct link to the original feedback item |
| `priority` | Based on authority level: decision-maker=high, reviewer=medium, observer=low |
| `ambiguity_flags` | List of ambiguity flags on this item (if any) |
| `status` | `open` for actionable items, `deferred` for out-of-scope, `blocked` for broken provenance |

**Critical rules:**
- Title must describe what to REVIEW, not what to IMPLEMENT
- Description must include or reference the verbatim feedback
- Every task must have a provenance citation — no citation = no task
- Items with `broken` provenance get `status: blocked` with explanation
- Out-of-scope items get `status: deferred` and go to the Deferred section

### Step 3: Present for Review [USER]

Present the compiled task list to the user for review:

1. Show total task count by status (open, deferred, blocked)
2. Show task count by priority (high, medium, low)
3. Show any items that were excluded and why
4. List all ambiguity flags that need resolution

**STOP and wait for user response before proceeding.**

If the user requests changes, apply them and present again.

### Step 4: Write Final Outputs [AUTO]

Write two output files:

**`task_output/TASK_LIST.md`** (if destination_format is `markdown`):

```markdown
# Task List — [Project Name]

> Compiled from [source_tool] feedback on [date]
> Source: [source_location]

## Summary
- Total tasks: N
- Open: N | Deferred: N | Blocked: N
- High priority: N | Medium: N | Low: N

## Open Tasks

### [PREFIX]-001: [Title]
**Priority:** High | **Source:** [Author] ([Role])
**Provenance:** Feedback on [Item] at [Timestamp]
> "[Exact quote from stakeholder]"

**Description:** [Expanded description]

**Ambiguity flags:** [If any]

---

## Deferred (Out of Scope)

### [PREFIX]-NNN: [Title]
**Reason deferred:** [Scope boundary citation]
**Source:** [Author] ([Role])
> "[Exact quote]"

---

## Blocked (Insufficient Provenance)

### [PREFIX]-NNN: [Title]
**Blocked reason:** [What provenance is missing]
**Source:** [Partial provenance chain]

---

## Ambiguity Summary

Items requiring clarification before tasks can be finalized:

| Task ID | Ambiguity | Clarification Needed |
|---------|-----------|---------------------|
| [ID] | [Type]: [Description] | [Question] |
```

**`task_output/task_compilation_summary.json`**:

```json
{
  "compilation_metadata": {
    "compiled_at": "ISO 8601 timestamp",
    "source_tool": "dart|notion",
    "source_location": "location",
    "destination_format": "markdown|json|github-issues",
    "task_prefix": "PREFIX"
  },
  "summary": {
    "total_tasks": 0,
    "by_status": {"open": 0, "deferred": 0, "blocked": 0},
    "by_priority": {"high": 0, "medium": 0, "low": 0},
    "total_ambiguity_flags": 0,
    "items_excluded": 0
  },
  "tasks": [
    {
      "task_id": "PREFIX-001",
      "title": "Short descriptive title",
      "description": "Expanded description",
      "provenance": "Full citation string",
      "source_url": "https://...",
      "priority": "high|medium|low",
      "authority_level": 1,
      "ambiguity_flags": [],
      "status": "open|deferred|blocked"
    }
  ]
}
```

If `destination_format` is `json`, write only `task_compilation_summary.json` with the full task data. If `github-issues`, write both files plus a note about GitHub issue creation format.

### Step 5: Owner-Grouped Output Mode [OPTIONAL — OFF BY DEFAULT]

The **flat list above is the default and is never removed.** This step adds an
*optional* owner-grouped projection of the same tasks. It is a re-grouping only —
no task field is mutated, dropped, re-prioritized, or re-titled in the process.

**Gate (all conditions must hold; otherwise emit the flat list and skip this step):**

1. The destination is a **client-deliverable board with a distinct owner audience**
   (a surface read by named stakeholders/owners, not just the developer queue).
   Read this from `communication_architecture.json` — e.g. `destination_format`
   is `github-issues` or a client board, and `stakeholders[]` describes an owner
   audience distinct from the implementing developer.
2. **2+ contributors** exist in `stakeholders[]` (the For-X partition layer only
   adds value when feedback comes from more than one person). With a single
   contributor, keep the flat list.

When the gate does **not** hold, the existing flat `TASK_LIST.md` /
`task_compilation_summary.json` are the only outputs. Do not ask the user to enable
this mode; it is offered when warranted, and the flat default stands otherwise.

**3-level shape when enabled:**

- **Owner Summary** parent (type `owner_summary`) — one root node naming the
  deliverable board, the source tool, the compile date, and the same summary
  counts as the flat list (by_status, by_priority, ambiguity total).
- **`For <Stakeholder/Owner>`** groupings (type `for_grouping`) — one node per
  stakeholder, partitioned using the `stakeholders[]` authority map from
  prompt 01 (`01_COMMUNICATION_ARCHITECTURE.md`). Each task is filed under the
  stakeholder it is attributed to in its provenance citation. A task whose
  author is not in `stakeholders[]` goes under a `For <Author>` node created from
  its provenance author so it is never orphaned.
- **Task children** — the exact task entries from Step 2, nested unchanged under
  the right person.

**Invariant preservation through the regrouping (mandatory):**

- Every task keeps its **full provenance citation + `source_url`**. No task may
  lose its provenance because it moved under a For-X. A task with no resolvable
  provenance author is **not** silently dropped — it stays `blocked` and is
  surfaced (see below).
- **Authority → priority mapping is unchanged** (decision-maker=high,
  reviewer=medium, observer=low). Grouping by person does not re-rank tasks;
  priority is still the per-task field from Step 2.
- **Titles still describe what to REVIEW, not implement.** Re-grouping never
  rewrites a title.
- **Ambiguity flags are retained** on each task and still roll up into the
  Ambiguity Summary table (which remains a single flat table, not per-person).
- **Broken-provenance items stay `blocked`** and are placed under a dedicated
  `For Unattributed / Blocked` `for_grouping` node (never hidden, never
  promoted into a stakeholder's actionable list).
- `deferred` items remain `deferred` and may be grouped under their author with a
  visible deferred marker, exactly as the flat Deferred section records them.

**Markdown projection (`TASK_LIST.md`, owner-grouped variant — additive):**

```markdown
# Owner Summary — [Deliverable Board Name]

> Compiled from [source_tool] feedback on [date] · Source: [source_location]
> Open: N | Deferred: N | Blocked: N · High: N | Medium: N | Low: N

## For [Stakeholder Name] ([role], authority [level])

### [PREFIX]-001: [Title]
**Priority:** High | **Source:** [Author] ([Role])
**Provenance:** Feedback on [Item] at [Timestamp]
**Source URL:** [source_url]
> "[Exact quote from stakeholder]"

**Description:** [Expanded description]
**Ambiguity flags:** [If any]

---

## For [Other Stakeholder] (...)
### [PREFIX]-NNN: ...

---

## For Unattributed / Blocked
### [PREFIX]-NNN: [Title]
**Blocked reason:** [What provenance is missing]
**Source:** [Partial provenance chain]

---

## Ambiguity Summary
(unchanged single flat table — see Step 4)
```

**JSON projection (additive `hierarchy` field on `task_compilation_summary.json`):**

When this mode is enabled, add a top-level `hierarchy` object **alongside** the
existing `tasks` array (the flat `tasks` array is still written in full and
remains the source of truth — `hierarchy` only references `task_id`s):

```json
{
  "hierarchy": {
    "enabled": true,
    "creator": "create-tasks-from-workspace.js",
    "root": {
      "type": "owner_summary",
      "title": "Owner Summary — [Deliverable Board Name]",
      "children": [
        {
          "type": "for_grouping",
          "stakeholder": "Stakeholder Name",
          "authority_level": 1,
          "task_ids": ["PREFIX-001", "PREFIX-004"]
        },
        {
          "type": "for_grouping",
          "stakeholder": "Unattributed / Blocked",
          "authority_level": null,
          "task_ids": ["PREFIX-007"]
        }
      ]
    }
  }
}
```

The tree node referenced by `creator` (`create-tasks-from-workspace.js`) is the
creator responsible for materializing this `owner_summary` → `for_grouping` →
task hierarchy on the destination board. Every `task_id` under any
`for_grouping` MUST resolve to an entry in the flat `tasks` array carrying its
full provenance, `source_url`, priority, title, and ambiguity flags — the
hierarchy adds structure, never a second copy of task data, and never a task that
is absent from the flat list.

## Output

- `task_output/TASK_LIST.md` — Human-readable task list with provenance citations
- `task_output/task_compilation_summary.json` — Machine-readable compilation with full metadata

## Success Criteria

- Every task has a provenance citation linking to a specific feedback item
- No task titles contain implementation directives (review/investigate only)
- Authority-based priority correctly applied (decision-maker > reviewer > observer)
- Out-of-scope items in Deferred section, never in Open
- Broken-provenance items in Blocked section with explanation
- Ambiguity summary table complete
- Both output files are valid and consistent with each other
- User reviewed and approved the task list before finalization
- (Owner-grouped mode only) Flat list remains the default; owner grouping is emitted only when the client-deliverable-board + 2+-contributor gate holds; every `task_id` under a `for_grouping` resolves to a flat-list entry retaining full provenance + `source_url`, unchanged authority→priority, review-not-implement title, and ambiguity flags; broken-provenance items stay `blocked` and surfaced, never promoted

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Missing prior artifacts | Cannot compile tasks | Report which artifacts are missing; stop |
| All items have broken provenance | Empty task list | Write blocked items; report to user |
| User rejects task list | Outputs not finalized | Apply requested changes; re-present for review |
| Contradictory feedback unresolved | Tasks may conflict | Both items become tasks; contradiction noted in ambiguity flags |
| No task prefix provided | IDs lack project context | Default to `TASK` prefix: TASK-001, TASK-002, etc. |
