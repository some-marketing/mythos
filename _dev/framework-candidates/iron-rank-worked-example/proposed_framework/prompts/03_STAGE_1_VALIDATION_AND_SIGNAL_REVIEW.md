# 03 Stage 1 Validation And Signal Review

## Objective

Run the required Stage 1 validations and capture structured evidence for whether the stage exit criteria were met.

## Mode

RUN_ONLY

## Inputs

- changed files from Stage 1
- Stage 1 validation profile
- stage exit criteria

## Steps

1. Run the required Stage 1 validation commands.
2. Capture command outcomes, including failures.
3. Map each validation result back to a Stage 1 acceptance criterion.
4. Identify any remaining manifest drift or verification blind spots.
5. Emit a structured validation-results artifact.

## Outputs

- `artifacts/validation_results.json`
- updated `artifacts/stage_status.json`

## Success Criteria

- Every Stage 1 criterion has explicit evidence.
- Validation failures are preserved, not summarized away.

## Guardrails

- Report actual command results only.
- Do not perform additional fixes in this prompt.

