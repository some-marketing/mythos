# Claude Prompt Pack: Command Adherence And Validation Hardening

Prompt pack for hardening the command surfaces and watcher logic using the lessons already proven in recent multi-actor pipeline runs.

Primary source material:
- [`_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`](../COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md)
- [`_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`](../LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md)
- [`_dev/reports/analysis/command-adherence-and-validation-task-map.md`](../reports/analysis/command-adherence-and-validation-task-map.md)
- [`_dev/reports/analysis/session-learnings__2026-03-28__pipeline-completion.md`](../reports/analysis/session-learnings__2026-03-28__pipeline-completion.md)
- [`_dev/reports/analysis/review-progress__advance-pipeline.md`](../reports/analysis/review-progress__advance-pipeline.md)
- your distinct-family-reviewer bridge runbook, if your project has one

Primary target files:
- `.claude/commands/**`
- `tools/signals/**`
- `tests/lifecycle/**`
- selected planning/review surfaces when closeout rules need to be made durable

## Goal

Turn repeated command and watcher failures into tighter command behavior and lightweight executable validation.

Desired outcome:
- successful stage closes always leave deterministic verification artifacts
- stage completion does not leave planning surfaces stale
- exact scoped commands survive watcher handoffs
- listener scope boundaries stay enforced
- lessons review happens on a real cadence during long-running sessions

## Why This Matters

The system already has the right high-level workflow, but several failures repeated across sessions:
- successful track closes sometimes wrote only JSON and skipped markdown verification reports
- planning refresh often lagged behind completed tracks
- watcher logic broadened or replaced exact handoff commands
- main listeners reacted to scoped workstreams they did not own

These are not new-architecture problems. They are adherence and validation problems.

## Recommended Near-Term Slice

Start with:
1. command-closeout validation rules
2. planning-refresh validation on track completion
3. watcher tests for exact-command preservation and scoped-signal isolation
4. signal/artifact truthfulness checks for closeout handoffs

Immediately after that lane is stable, the next bounded slice should operationalize the lessons reconciliation loop:
5. recurring lessons trigger and artifact contract
6. bounded promotion of repeated lessons into hardening tasks or signals

Do not start with:
- a broad new orchestration framework
- provider/runtime work unrelated to command adherence
- repo-wide validator breadth before the highest-value drift cases are covered

## Prompt 1: Coordinator Kickoff

```text
Harden the Mythos command surfaces and add the first lightweight validation for the command-drift failures already seen in production sessions.

Read these files first:
- `_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`
- `_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`
- `_dev/reports/analysis/command-adherence-and-validation-task-map.md`
- `_dev/reports/analysis/session-learnings__2026-03-28__pipeline-completion.md`
- `_dev/reports/analysis/review-progress__advance-pipeline.md`
- your distinct-family-reviewer bridge runbook, if your project has one
- `.claude/commands/advance-pipeline.md`
- `.claude/commands/review-progress.md`
- `.claude/commands/plan-pipeline.md`
- `tools/signals/lib/pipeline-loop.js`
- `tests/lifecycle/pipeline-loop-watch.test.js`

Goal:
- make command-closeout behavior more deterministic
- make lessons reconciliation part of long-loop review behavior
- add the smallest code validation that covers the repeated drift cases
- keep the work bounded to command adherence and watcher validation

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only subagents in parallel:
   - one for command-closeout / planning-refresh gap inventory
   - one for watcher / signal-validation gap inventory
4. Synthesize findings in the main thread.
5. Implement exactly one bounded high-value slice.
6. Add or update tests where practical.
7. Run validation.
8. Launch one read-only completion-auditor-style subagent.

Acceptance criteria:
1. The chosen command-adherence slice is implemented without widening into unrelated orchestration work.
2. The slice adds or tightens executable validation for at least one repeated failure mode.
3. Any changed command behavior is made explicit in the command docs or planning surfaces.
4. The final report states what drift case is now covered and what remains deferred.
5. If the slice reaches the lessons-loop part, it must say what recurring trigger and artifact shape were added.

Final response must include:
- changed files
- validations run
- which repeated lesson/failure mode was hardened
- what remains intentionally deferred
```
