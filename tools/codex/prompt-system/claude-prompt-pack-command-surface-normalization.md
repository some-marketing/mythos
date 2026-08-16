# Claude Prompt Pack: Command Surface Normalization

Prompt pack for moving Mythos command behavior from Claude-only command files toward a harness-neutral command-spec layer with truthful Codex fallback resolution.

Primary source material:
- [`_dev/HARNESS_COMMAND_SURFACE_ABSTRACTION.md`](../HARNESS_COMMAND_SURFACE_ABSTRACTION.md)
- [`_dev/HARNESS_COMMAND_SURFACE_IMPLEMENTATION_PLAN.md`](../HARNESS_COMMAND_SURFACE_IMPLEMENTATION_PLAN.md)
- [`instructions/canonical/system.yaml`](../../instructions/canonical/system.yaml)
- [`instructions/adapters/codex.yaml`](../../instructions/adapters/codex.yaml)
- [`instructions/adapters/claude.yaml`](../../instructions/adapters/claude.yaml)
- [`instructions/README.md`](../../instructions/README.md)

Primary target files:
- new files under `instructions/canonical/commands/`
- [`tools/instructions/lib/engine.js`](../../tools/instructions/lib/engine.js)
- renderer/generator logic under `tools/instructions/`
- [`tools/instructions/validate.js`](../../tools/instructions/validate.js)
- [`tools/verify/verify-system.cjs`](../../tools/verify/verify-system.cjs)
- [`AGENTS.md`](../../AGENTS.md)
- generated Claude command surfaces and related docs as needed

## Goal

Normalize Mythos operations into a harness-neutral command-spec model so Claude can keep native command ergonomics while Codex and other harnesses use explicit fallback resolution against the same source behavior.

Desired outcome:
- canonical command behavior is no longer trapped in `.claude/commands/*.md`
- Codex command handling is explicit and truthful
- linked Dart-task behavior is normalized when bounded active work already exists
- the existing repo log model is reused consistently across command flows
- validation proves operation/spec/adapter coverage
- prompt-system and planning commands behave consistently across harnesses

## Why This Matters

The repo already abstracts instruction policy and harness capabilities.

The next mismatch is command behavior:
- operations are canonical
- behavior is still Claude-local
- Codex sees operation inventory but not a native command registry

This pack closes that gap without pretending every harness has the same UI affordances.

It also needs to close the next practical gap:
- the repo now has a hybrid repo-truth / Dart-active-work / git-evidence model
- Dart comments already act as the human-facing coordination log
- `_dev/reports/analysis/` and `_dev/reports/signals/` already act as the durable execution log
- command behavior is still underspecified about when linked Dart tasks should be read, updated, or ignored

This pack should normalize that behavior without creating a second queue, a second planning system, or a second logging surface.

## Claude Optimization Notes

Optimize this pack for Claude by:
- keeping the first migration to 3-5 operations, not the full command surface
- requiring explicit file-read lists before planning
- using read-only subagents only for bounded inventory work
- keeping one write-owning implementation slice at a time
- forcing validation before any completion claim

Avoid Claude anti-patterns:
- broad command-surface rewrites in one pass
- duplicating behavior in multiple harness outputs manually
- abstract design discussion without concrete file ownership and validation steps

## Multi-Agent Functionality

- Main Claude thread owns scope decisions, synthesis, and go/no-go decisions.
- Use at most 2 read-only subagents for bounded inventory or impact analysis.
- Use one write-owning worker slice at a time unless write scopes are clearly disjoint.
- Validation and completion audit remain read-only.
- If a second write slice is required, leave it as explicit follow-up work rather than widening the first worker.

## Model Guidance

- Coordinator kickoff:
  - use the strongest implementation-capable Claude path available
  - keep full repo/tool context in the main thread
- Explorer prompts:
  - use read-only Task/Explore style execution only
  - do not allow file writes or scope expansion
- Worker prompts:
  - use an implementation-capable Claude path with tool access
  - keep ownership bounded to the declared write surface
- Validation prompt:
  - use a read-only validation pass
  - do not convert validation into new implementation
- Completion audit prompt:
  - use a read-only auditor posture
  - report blocker/warning/info findings only

## How To Use This Pack

Run this pack in four implementation tasks:

1. canonical command-spec design
2. Claude rendering migration
3. Codex fallback-resolution integration
4. validation and docs alignment

Then run:

5. validation
6. completion audit

Keep the first migration bounded to a small set of system operations before widening scope.

When this pack touches active-work behavior, reuse the existing log model:
- `_dev/reports/analysis/` for full reasoning and review artifacts
- `_dev/reports/signals/` for operational state transitions
- Dart comments/status for short operator-visible breadcrumbs
- git commits and Evidence footers for landed proof

## Recommended Near-Term Slice

If this pack is used soon, start with:
1. canonical command specs for `review-progress`, `author-prompt-system`, `assemble-prompt-system`, `plan-pipeline`, and `advance-pipeline`
2. a linked-task contract that says when those operations should read or update an existing Dart task
3. explicit Codex fallback-resolution guidance pointing to those canonical specs
4. structural validation for operation/spec/adapter coverage

Why this first:
- it fixes the concrete Codex command UX gap already observed
- it makes the existing hybrid repo/Dart/evidence model operational instead of implicit
- it keeps Claude useful without leaving it as the only behavioral source
- it adds command-surface drift detection before a larger migration

Do not start with:
- framework-level command migration
- full command-surface normalization for every operation in one pass
- adapter-specific command polish before the shared contract exists
- a new standalone logging system or queue runtime

## Existing Log Model To Reuse

Do not invent a fresh logging layer for this work. Reuse the existing repo model:

- Dart comments are the short inter-actor coordination log
- task status on the board is the human-visible state signal
- `_dev/reports/analysis/` artifacts remain the durable reasoning and review surface
- `_dev/reports/signals/` remains the operational state surface
- git commits and repo artifacts remain the evidence trail

The command-surface work should only decide:
- when a linked Dart task is relevant enough to read
- when a status, handoff, blocked, or evidence breadcrumb should be written
- how repo artifacts point back to the linked task truthfully

## Linked Task Contract

Treat an operation as Dart-aware only when all are true:
- the work is bounded enough to execute or review as a single slice
- a real Dart task or Brief already exists
- the task has at least one durable repo link (`Plan`, `Context`, or `Evidence`)
- the task is part of active execution, review, or blocked coordination

If those conditions are not met:
- keep planning and analysis repo-first
- do not force the operation to create or depend on a Dart task
- do not treat Dart as the orchestration queue

---

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Normalize the Mythos command surface so operation behavior becomes harness-neutral while Claude retains native command ergonomics and Codex uses explicit fallback resolution.

Read these files first:
- `_dev/HARNESS_COMMAND_SURFACE_ABSTRACTION.md`
- `_dev/HARNESS_COMMAND_SURFACE_IMPLEMENTATION_PLAN.md`
- `instructions/canonical/system.yaml`
- `instructions/adapters/claude.yaml`
- `instructions/adapters/codex.yaml`
- `instructions/README.md`
- `tools/instructions/lib/engine.js`
- `tools/instructions/validate.js`
- `tools/verify/verify-system.cjs`
- `.claude/commands/review-progress.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `.claude/commands/plan-pipeline.md`
- `.claude/commands/advance-pipeline.md`

Goal:
- add a canonical command-spec layer
- keep Claude command files as a renderer output or thin wrapper
- give Codex a truthful resolution path through `AGENTS.md`
- add validation that catches missing command coverage
- prioritize the near-term slice above before widening scope

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for command-spec and adapter-boundary design
   - one for engine/render/validation impact analysis
4. Synthesize findings in the main thread.
5. Implement exactly one bounded migration slice before widening scope.
6. Add or update validation/tests.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. A canonical command-spec layer exists for the migrated operations.
2. Claude command behavior is no longer the only behavioral source for those operations.
3. Codex has explicit command-resolution guidance that points to canonical specs.
4. Validation fails when command coverage is missing.
5. The migration remains truthful about harness differences.

Constraints:
- do not pretend Codex has native slash commands
- do not duplicate full behavior independently across harness files
- keep the first migration bounded to a small, high-value set of operations
- avoid unrelated refactors
- stop and report if the migration requires broad framework-level command changes

Final response must include:
- changed files
- migrated operations
- renderer/fallback decisions
- validations run
- remaining migration gaps
```

## Prompt 2: Explorer A - Command Model Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Design the smallest safe command-spec abstraction for Mythos.

Read:
- `_dev/HARNESS_COMMAND_SURFACE_ABSTRACTION.md`
- `_dev/HARNESS_COMMAND_SURFACE_IMPLEMENTATION_PLAN.md`
- `instructions/canonical/system.yaml`
- `.claude/commands/review-progress.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `.claude/commands/plan-pipeline.md`
- `.claude/commands/advance-pipeline.md`

Return exactly these sections:

Findings
- current command-model limitations with file references

Implementation notes
- recommended command-spec shape
- what stays canonical versus adapter-specific
- safest first migration set

Risks
- behavior drift risks
- over-abstraction risks
- migration-order risks

Do not edit files.
```

## Prompt 3: Explorer B - Engine And Validation Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Audit what engine, rendering, and validation changes are required for canonical command specs and Codex fallback resolution.

Read:
- `instructions/adapters/claude.yaml`
- `instructions/adapters/codex.yaml`
- `instructions/README.md`
- `tools/instructions/lib/engine.js`
- `tools/instructions/validate.js`
- `tools/verify/verify-system.cjs`
- `AGENTS.md`

Return exactly these sections:

Findings
- current assumptions about command handling with file references

Implementation notes
- loader/render changes required
- validation coverage to add
- what can remain thin-wrapper behavior for now

Risks
- accidental generated-output drift
- missing adapter coverage
- partial migration hazards

Do not edit files.
```

## Prompt 4: Worker - Canonical Command Specs And Render Path

Use this as the first write-owning implementation prompt.

```text
Implement the first bounded pass of command-surface normalization in Mythos.

Ownership:
- `instructions/canonical/system.yaml`
- new files under `instructions/canonical/commands/`
- `tools/instructions/*`
- `tools/verify/verify-system.cjs`
- validation/tests related to command coverage
- generated command/instruction surfaces if required by the generator

You are not alone in the codebase. Do not revert edits by others.

Task:
- add a canonical command-spec layer for a small set of system operations
- keep Claude command files working through the new structure or thin wrappers
- add explicit Codex fallback-resolution handling
- add validation for missing command coverage
- do the smallest coherent slice that leaves the repo in a validated state

Constraints:
- keep the first migration small and truthful
- do not force framework-level command migration yet
- preserve current instruction generation behavior where not explicitly migrated
- if a second slice is needed, leave it as explicit follow-up work rather than broadening this task

Final response must include:
- changed files
- operations migrated
- renderer/fallback decisions
- validation changes made
- remaining follow-up work
```

## Prompt 5: Validation Prompt

Use this after implementation.

```text
Validate the command-surface normalization work.

Acceptance criteria:
1. A canonical command-spec layer exists for the migrated operations.
2. Claude command behavior is no longer the only behavioral source for those operations.
3. Codex command handling is explicit and truthful.
4. Validation catches missing command coverage.
5. The migration remains bounded and does not overstate harness parity.

Run relevant validation and inspect the changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining command-surface risks
```

## Prompt 6: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the command-surface normalization work.

Acceptance criteria:
1. Command behavior is moving toward a harness-neutral source of truth.
2. Claude remains high-utility without being the only behavioral source.
3. Codex fallback handling is explicit instead of accidental.
4. Validation covers the new command-surface contract.

Inputs to inspect:
- changed files
- validation output
- updated docs and generated surfaces

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
