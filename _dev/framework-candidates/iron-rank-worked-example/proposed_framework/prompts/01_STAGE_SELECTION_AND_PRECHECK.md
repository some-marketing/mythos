# 01 Stage Selection And Precheck

## Objective

Confirm that the requested stage is executable by this candidate and generate a deterministic Stage 1 execution plan.

## Mode

COORDINATOR

## Inputs

- `run_order_doc`
- `stage_id`
- `repo_scope`
- `validation_profile`
- optional `stage_definition`
- optional `resume_from_artifacts`

## Steps

1. Read the run-order source of truth and confirm the requested stage exists.
2. Verify that `stage_id` is `stage-1-semantic-verification`.
3. Read the stage definition if provided; otherwise derive the Stage 1 definition from the framework docs.
4. Confirm the required target files are within the declared repo scope.
5. Confirm that Stage 1 is allowed to write only the named verifier, package, manifest, and test surfaces.
6. If any precondition fails, emit a blocked status and stop.
7. If all preconditions pass, emit an execution plan for Stage 1 and continue.

## Outputs

- `artifacts/stage_status.json`
- `reports/STAGE_REPORT.md`

## Success Criteria

- The stage is confirmed as executable by this candidate.
- The execution scope is explicit.
- Any ambiguity is surfaced before implementation begins.

## Guardrails

- Do not infer support for later stages.
- Do not proceed if write scope is ambiguous.

