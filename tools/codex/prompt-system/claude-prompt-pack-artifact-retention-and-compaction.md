# Claude Prompt Pack: Artifact Retention And Compaction

Prompt pack for introducing logging, retention, compaction, and archive policy so Mythos artifact growth stays bounded.

Primary source material:
- [`_dev/ARTIFACT_RETENTION_AND_COMPACTION_ARCHITECTURE.md`](../ARTIFACT_RETENTION_AND_COMPACTION_ARCHITECTURE.md)
- [`_dev/ARTIFACT_RETENTION_AND_COMPACTION_IMPLEMENTATION_PLAN.md`](../ARTIFACT_RETENTION_AND_COMPACTION_IMPLEMENTATION_PLAN.md)
- [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md)

Primary target files:
- future `tools/artifacts/*`
- [`.claude/commands/project-status.md`](../../.claude/commands/project-status.md)
- [`tools/workspace/candidate-status.js`](../../tools/workspace/candidate-status.js)
- artifact-producing lifecycle tools and docs as needed

## Goal

Prevent Mythos from sprawling as more reports, signals, replay runs, and lifecycle artifacts are generated.

Desired outcome:
- current-state artifacts stay easy to inspect
- historical evidence remains available
- low-value mechanical noise is compacted
- archive and flush behavior become policy-driven

## How To Use This Pack

Run this pack in four implementation tasks:

1. retention-state model and status tooling
2. current-state paths and signal compaction
3. candidate/lifecycle retention policy
4. docs and status-surface alignment

Then run:

5. validation
6. completion audit

## Prompt 1: Coordinator Kickoff

```text
Implement artifact retention and compaction for Mythos.

Read these files first:
- `_dev/ARTIFACT_RETENTION_AND_COMPACTION_ARCHITECTURE.md`
- `_dev/ARTIFACT_RETENTION_AND_COMPACTION_IMPLEMENTATION_PLAN.md`
- `_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`
- `.claude/commands/project-status.md`
- `tools/workspace/candidate-status.js`
- inspect `_dev/reports/` and current client project artifact directories

Goal:
- add explicit artifact retention policy
- create status/inspection tooling
- compact noisy mechanical artifacts safely
- preserve high-value evidence for learning and promotion

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for retention-state/status tooling design
   - one for status-surface and candidate-impact analysis
4. Synthesize findings.
5. Implement in bounded phases.
6. Run validation.
7. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. Artifact growth is inspectable.
2. A bounded compaction strategy exists for noisy surfaces.
3. High-value promotion/learning evidence is preserved.
4. Current-state status surfaces remain truthful.
5. Cleanup is policy-driven, not ad hoc.

Final response must include:
- changed files
- retention policy decisions
- validations run
- remaining sprawl risks
```

## Prompt 2: Explorer A - Retention Inventory

```text
You are a read-only Task subagent.

Purpose:
Inventory likely artifact-sprawl surfaces and propose the smallest safe retention model.

Read:
- `_dev/ARTIFACT_RETENTION_AND_COMPACTION_ARCHITECTURE.md`
- `_dev/ARTIFACT_RETENTION_AND_COMPACTION_IMPLEMENTATION_PLAN.md`
- current `_dev/reports/` layout
- current client project artifact directories

Return exactly these sections:

Findings
- highest-risk sprawl locations with file references or paths

Implementation notes
- best first compaction target
- recommended current-vs-history split
- recommended retention states

Risks
- evidence-loss risks
- over-compaction risks

Do not edit files.
```

## Prompt 3: Explorer B - Status Surface Inventory

```text
You are a read-only Task subagent.

Purpose:
Evaluate how retention and compaction will affect status surfaces.

Read:
- `.claude/commands/project-status.md`
- `tools/workspace/candidate-status.js`
- retention architecture docs

Return exactly these sections:

Findings
- where status logic currently depends on raw directory layout

Implementation notes
- what status surfaces should point to after compaction
- what can be deferred

Risks
- misleading “empty” or “missing” status after archiving/compaction

Do not edit files.
```

## Prompt 4: Worker - Retention Tooling And Policy

```text
Implement the first retention and compaction tooling for Mythos.

Ownership:
- `tools/artifacts/**`
- related status/docs files only if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- add artifact status tooling
- add the first safe compaction path
- prefer `_dev/reports/signals/` as the first target unless evidence suggests otherwise
- keep archive behavior safer than flush behavior

Final response must include:
- changed files
- tooling added
- first compaction target
- remaining follow-up work
```

## Prompt 5: Worker - Status Alignment

```text
Align project or candidate status surfaces with the new retention/compaction model.

Ownership:
- `.claude/commands/project-status.md`
- `tools/workspace/candidate-status.js`
- related docs only if needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- ensure status surfaces remain truthful after compaction/archive behavior exists
- point status toward current-state artifacts where appropriate
- document any deferred alignment explicitly

Final response must include:
- changed files
- status-surface changes
- what remains deferred
```

## Prompt 6: Validation Prompt

```text
Validate the artifact retention and compaction work.

Acceptance criteria:
1. Artifact growth is inspectable.
2. A safe first compaction path exists.
3. High-value evidence remains protected.
4. Status surfaces remain truthful.
5. Archive/flush policy is clearly differentiated.

Run relevant validation and inspect changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining risks
```

## Prompt 7: Completion Audit Prompt

```text
Act as a completion auditor for the artifact retention and compaction work.

Acceptance criteria:
1. Mythos now has an explicit anti-sprawl policy.
2. Mechanical artifact growth is bounded more safely.
3. Promotion and learning evidence remain auditable.
4. Status surfaces still tell the truth after compaction/archive behavior.

Inputs to inspect:
- changed files
- validation output
- updated docs and tooling

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
