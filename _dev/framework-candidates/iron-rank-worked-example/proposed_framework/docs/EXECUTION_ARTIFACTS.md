# Execution Artifacts

## Required Structured Artifacts

Every stage run should emit:

- `artifacts/stage_status.json`
  - current state of the stage execution
  - changed files
  - blocker and warning inventory

- `artifacts/validation_results.json`
  - commands run
  - pass/fail outcomes
  - criterion-by-criterion validation mapping

- `artifacts/next_stage_decision.json`
  - whether the next stage may start
  - recommended next stage id
  - blockers or deferred work

- `reports/STAGE_REPORT.md`
  - human-readable summary of what changed and why

- `reports/COMPLETION_AUDIT.md`
  - final completion audit against stage acceptance criteria

## First-Pass Limitation

This candidate defines the artifact contract and a replay-oriented example, but does not yet provide a native runner that writes these artifacts automatically.

