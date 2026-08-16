# Plan Contract

Policy defining the minimum structure a reusable quest charter (task plan) must expose
so that any executor (current or future) can drive it through the standard `/embark`
primitive.

## Purpose

Charters in this workshop are ordered documents that describe what work to do, in what
order, with what exit criteria. This contract defines the structural expectations so that:

- Different charters share a common shape
- Executors can parse stages, gates, and exit criteria without charter-specific logic
- Stage state tracking follows a consistent convention
- Future charters can follow the same pattern

This is a policy document, not a code schema. It defines what a charter SHOULD contain.
Machine-checkable validation may follow in a later phase once a second use case exists.

## Required Charter Elements

### 1. Stages (ordered list with IDs)

Every charter must define an ordered sequence of stages. Each stage must have:

- **Stage ID**: A stable identifier (number, slug, or composite like `track-a`). The ID
  must not change when stages are reordered or new stages are inserted.
- **Title**: A human-readable name for the stage.
- **Order**: The position in the execution sequence. Tracks or parallel work groups may
  exist alongside the main sequence but must declare their ordering relationship.

Example:

```
| Stage | Title | Status |
|------:|-------|--------|
| 1     | Semantic verification and coverage check | Done |
| 2     | Housekeeping and stabilization | Done |
```

### 2. Exit criteria per stage

Each stage must declare its completion conditions using the "Do not proceed until"
pattern or equivalent.

Exit criteria must be:

- **Observable**: Checkable against repo state (file existence, test results, artifact
  presence), not against conversation claims or self-reports.
- **Specific**: Reference concrete files, scripts, test commands, or artifact paths
  rather than vague quality statements.
- **Independent of the executor**: Any agent or operator should be able to verify them
  without context from the build step.

Example:

```
Do not proceed until:
- the verifier fails on unresolved chain references
- the full-verify command covers every registered grimoire
- known drift is fixed or intentionally surfaced
```

### 3. Gate types

Charters may include gates that interrupt automatic advancement. Recognized gate types:

| Gate Type | Meaning | Executor Behavior |
|-----------|---------|-------------------|
| **Human gate** | Requires real-world usage, operator decision, or manual confirmation | Stop and surface. Never simulate. |
| **Deferral condition** | Preconditions depend on decisions or priorities the operator has not expressed | Stop and ask. Never assume. |
| **Blocker** | A stage that fails after maximum fix cycles | Stop and report with failure artifacts. |

Gates are defined inline in the charter, typically as notes attached to individual stages.

### 4. Prompt-pack reference per stage (optional)

Stages may reference a prompt pack or task system that contains the detailed
implementation guidance for that stage.

Format: a "Use:" section pointing to a file path relative to the repo root.

```
Use:
- `tools/codex/prompt-system/claude-prompt-pack-semantic-verification.md`
```

Charters that do not use prompt packs (e.g., simpler operational charters) may omit
this element.

### 5. Status tracking

Each charter must maintain a status table with per-stage status.

Recognized status values:

| Status | Meaning |
|--------|---------|
| **Done** | Exit criteria verified and confirmed. |
| **Open** | Not yet started or not yet complete. |
| **Partial** | Some exit criteria met, others remain. |
| **Deferred** | Intentionally deferred with stated reason. |

The status table is the authoritative record of charter progress. It must be updated
after each stage completes, not at the end of a session.

### 6. Artifact expectations per stage

Each stage should declare what artifacts it produces, so that verification can check
for their presence.

Artifact expectations may be explicit (listed per stage) or implicit (derived from the
executor convention, such as the expectation-failure JSON defined below).

## Stage-State Artifact Convention

This section defines the standard artifact convention for stage execution tracking.

### File locations

Stage completion artifacts go to:

- **Analysis report**: `_dev/reports/analysis/<executor>__<stage-id>.md`
- **Expectation failures**: `_dev/reports/analysis/<executor>__<stage-id>.expectation-failures.json`

Where `<executor>` is the command or tool name and `<stage-id>` is a filesystem-safe
version of the stage identifier.

### Expectation-failure JSON fields

```json
{
  "stage_id": "string — the stage identifier from the charter",
  "reviewed_at": "string — ISO 8601 timestamp of the verification",
  "acceptance_criteria_checked": ["string — list of criteria that were evaluated"],
  "failures": [
    {
      "id": "string — unique failure identifier",
      "severity": "string — CRITICAL | MAJOR | MINOR | INFO",
      "expected": "string — what the exit criterion required",
      "observed": "string — what was actually found",
      "evidence": "string — file path, test output, or command result",
      "recommended_next_action": "string — what to do about it"
    }
  ]
}
```

Rules:

- The JSON artifact must be written for every stage, even when all criteria pass (set
  `failures` to an empty array).
- Severity follows the standard classification: CRITICAL, MAJOR, MINOR, INFO.
- Evidence must reference durable artifacts (file paths, test outputs), not
  conversation state.
- The analysis report (`.md`) provides the human-readable narrative; the JSON provides
  the machine-parseable record.

## What This Contract Does NOT Cover

- **Executor implementation**: This contract defines the charter shape, not how to
  build a charter executor. A reusable executor prototype is deferred until a second
  use case exists.
- **Machine-parseable charter format**: The contract describes structural expectations
  in prose. A formal schema (JSON Schema, YAML spec) is deferred until the shape is
  validated by a second use case.
- **Cross-charter dependencies**: Charters are currently independent. Cross-charter
  ordering is out of scope.

## Relationship to an External Tracker (if you use one)

If you track stages in an external board or tracker, the charter status maps naturally:

| Charter Status | Tracker Column |
|-------------|-----------------|
| Open | Proposed / To-do |
| Partial | In Progress |
| Done | Done |
| Deferred | Decision Needed |

An external tracker is the active-work surface, not the strategic source of truth. The
charter document remains authoritative for sequencing and exit criteria.
