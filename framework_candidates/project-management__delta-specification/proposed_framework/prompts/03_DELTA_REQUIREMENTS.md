# 03 Delta Requirements

## Objective

Express the requested behavioral change as explicit added, modified, and removed requirements with observable scenarios.

## Mode

RUN_ONLY

## Inputs

- Baseline inventory
- Change proposal

## Steps

1. Write each added requirement and at least one observable scenario.
2. For each modified requirement, cite the baseline requirement and state the exact behavioral difference.
3. For each removed requirement, cite the baseline and explain the intended absence.
4. Use MUST, SHOULD, or MAY consistently to express requirement strength.
5. Record unchanged invariants that the delta must preserve.
6. Flag conflicts, merge ambiguity, and requirements lacking sufficient evidence.

## Outputs

- `delta-spec.json`

## Success criteria

- Added, modified, and removed requirements cannot be confused.
- Each requirement is behavior-level and testable.
- Unchanged invariants remain visible.
