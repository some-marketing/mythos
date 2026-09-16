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
2. Attach the source locator or evidence identifier supporting each added requirement and observable scenario; mark unsupported requirements as evidence gaps.
3. For each modified requirement, cite the baseline requirement and state the exact behavioral difference.
4. For each removed requirement, cite the baseline and explain the intended absence.
5. Use MUST, SHOULD, or MAY consistently to express requirement strength.
6. Record unchanged invariants that the delta must preserve.
7. Flag conflicts, merge ambiguity, and requirements lacking sufficient evidence.

## Outputs

- `delta-spec.json`

## Success criteria

- Added, modified, and removed requirements cannot be confused.
- Each requirement is behavior-level and testable.
- Each requirement and scenario is source-grounded or explicitly marked as unsupported.
- Unchanged invariants remain visible.
