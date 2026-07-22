# Data-Handling Policy

Lifecycle states and handling rules for artifacts produced in this workshop.

## Artifact Lifecycle States

Every artifact produced by working here (reports, signals, audits, analysis outputs,
captures, replay runs) moves through one of four states:

### 1. Active

The artifact is currently in use or being produced.

Rules:
- remains in its hot surface location (e.g. `_dev/reports/analysis/`, `_dev/reports/signals/`)
- may be updated in place by the producing workflow
- status surfaces should read from active artifacts
- do not archive or compact active artifacts

Examples:
- a report whose next-step recommendation has not been acted on
- a signal file that has not been consumed by the next actor
- an analysis report for an in-progress review cycle

### 2. Finished

The artifact has served its purpose. The producing workflow is complete, the review
cycle is closed, or the artifact has been superseded by a newer version.

Rules:
- eligible for archiving
- remains readable in place until archived
- archive tooling should target finished artifacts first
- do not delete finished artifacts without archiving first

Examples:
- an assembly report after the assembly cycle is closed
- a review-progress report after the findings have been addressed or acknowledged
- an adjudicator (reviewer) response after the review has been incorporated

### 3. Archived

The artifact has been moved from the hot surface into a dated archive directory.

Rules:
- stored under `_dev/archive/{year}-{month}/{surface}/`
- every archive operation is logged to `_dev/logs/archive.jsonl`
- archived artifacts are still accessible for audit and traceability
- do not delete archived artifacts without explicit operator confirmation
- archived artifacts should not appear in status surface queries by default

Examples:
- `_dev/archive/2026-03/analysis/prompt-system-assembly.md`
- `_dev/archive/2026-03/analysis/review-progress__repo.md`

### 4. Evidence-Critical / Pinned

The artifact underpins a production decision, promotion gate, learning evaluation, or
compliance requirement.

Rules:
- never auto-archived or auto-deleted
- must be explicitly unpinned before any retention action applies
- protected patterns in `retention-policy.json` enforce this mechanically
- pinning can be indicated by:
  - matching a protected glob pattern in `retention-policy.json`
  - containing a `"pinned": true` field in machine-readable metadata
  - living under a `pinned/` directory

Examples:
- a candidate summary that was the basis for a grimoire rank-up decision
- a replay run summary that evidences learning-loop readiness
- a learning-ledger snapshot tied to a rank-up decision
- original captured evidence for a delivered patron artifact

## State Transitions

```
active --> finished --> archived
  |                      |
  +--> pinned (can return to active or stay indefinitely)
```

- `active -> finished`: the producing workflow completes, or a newer artifact supersedes this one
- `finished -> archived`: archive tooling moves the artifact to the dated archive directory
- `active -> pinned`: operator or workflow marks the artifact as evidence-critical
- `pinned -> active`: operator explicitly unpins the artifact (rare)

## Identifying Finished Artifacts

For the `_dev/reports/analysis/` surface, an artifact is considered **finished** when:

1. It was produced by a closed review, assembly, authoring, or chronicle (debrief) cycle
2. Its paired machine-readable artifact (if any) has no unresolved `blocked_by` or `next_action` fields
3. It has been superseded by a newer report for the same scope (e.g. a newer assembly pass)
4. The active planning surface does not reference it as a current recommended action source

For the first implementation slice, finished identification uses a conservative heuristic:
- files older than a configurable age threshold (default: 7 days) AND
- not matching any protected pattern AND
- not the newest file in the surface (preserve-latest)

## Archive Log Contract

Every archive operation appends an entry to `_dev/logs/archive.jsonl`:

```json
{
  "ts": "2026-03-27T18:00:00Z",
  "event": "artifact.archive",
  "source": "_dev/reports/analysis/prompt-system-assembly.md",
  "destination": "_dev/archive/2026-03/analysis/prompt-system-assembly.md",
  "surface": "_dev/reports/analysis",
  "reason": "finished",
  "size_bytes": 2772,
  "operator": "archive-finished",
  "dry_run": false
}
```

Required fields:
- `ts`: ISO-8601 timestamp of the archive operation
- `event`: always `artifact.archive` for archive operations
- `source`: original file path relative to project root
- `destination`: archive path relative to project root
- `surface`: the retention surface key
- `reason`: why the artifact was archived (e.g. `finished`, `superseded`, `retention_exceeded`)
- `size_bytes`: file size at time of archive
- `operator`: tool or command that performed the archive
- `dry_run`: whether this was a dry-run (logged but not executed)

## Relationship to Existing Tooling

- `tools/artifacts/retention-policy.json`: defines surfaces, retention periods, protected patterns
- `tools/artifacts/artifact-status.js`: inspects artifact counts and retention state
- `tools/artifacts/artifact-cleanup.js`: policy-driven cleanup (archive or delete by surface config)
- `tools/artifacts/archive-finished.js`: narrow archive-only tool for the first target surface

The data-handling policy governs the lifecycle model. The tooling implements it.

## First Archive Target

The first surface targeted for archive operations:

**`_dev/reports/analysis/`** - finished review, assembly, authoring, and chronicle
(debrief) artifacts.

Rationale:
- these artifacts accumulate with each review/assembly cycle
- they are structurally simple (markdown + paired JSON)
- finished analysis reports have low ongoing operational value
- the surface is low-risk for evidence loss (no rank-up or learning evidence)

## Handoff Signal Lifecycle

Structured handoff signals between actors follow a dedicated lifecycle within the
signal surface:

### Live State

- Stored in `_dev/reports/signals/` alongside verification signals
- Represents actionable coordination state: cycle-complete, ready-for-review, blocked, or ready-for-clear
- Only live signals should influence the next actor or next command
- The live surface should remain small — close signals promptly after they are consumed

### Closed State

- Stored in `_dev/reports/signals/closed/`
- Set when a handoff signal has been consumed, resolved, or superseded
- Contains the original signal data plus `lifecycle_state: "closed"` and a `closed_at` timestamp
- Closures are logged to `_dev/logs/archive.jsonl` with event type `signal.close`

### Retention

- Closed handoff signals have a 30-day retention period (defined in `retention-policy.json`)
- After retention, closed signals are eligible for archive to `_dev/archive/{year}-{month}/signals/`
- Verification signals in the main surface retain their existing 30-day retention with delete action

### Anti-Sprawl Rules

- Do not leave consumed handoff signals in the live surface
- Use `npm run signals:close` (or `tools/signals/close-signal.js`) to close signals
- Periodically review the live surface to ensure only actionable signals remain
- The close-signal tool defaults to dry-run to prevent accidental closures

## Deferred for Later Slices

- Repo-wide compaction across all surfaces
- Automatic finished-state detection beyond age heuristic
- Signal compaction (live/closed model from shared-signal-memory work)
- Patron project artifact archiving
- Flush/delete commands
- Status surface rewrites to prefer archived vs active views
