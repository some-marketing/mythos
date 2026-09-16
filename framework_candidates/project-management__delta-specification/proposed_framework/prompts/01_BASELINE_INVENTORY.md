# 01 Baseline Inventory

## Objective

Establish an evidence-backed inventory of current behavior before describing any change.

## Mode

RUN_ONLY

## Inputs

- Change request
- Baseline sources
- Known consumers and constraints

## Steps

1. Inventory every baseline source and its authority.
2. Assign each observable current behavior a unique, stable `baseline_requirement_id`, then extract its contract surfaces.
3. Preserve the source locator, revision, digest, or evidence identifier for each behavior when supplied; mark unavailable provenance explicitly.
4. Map each behavior to known consumers.
5. Identify conflicts, stale sources, missing facts, and ambiguous ownership.
6. Separate direct observations from interpretations.
7. Halt any proposed delta whose baseline cannot be established.

## Outputs

- `baseline-inventory.json`

## Success criteria

- Every baseline behavior cites a source locator.
- Every baseline behavior preserves available source revision or evidence identity, or names the provenance gap.
- Every baseline behavior has a unique `baseline_requirement_id` that later modified or removed requirements can cite.
- Unknown behavior remains explicitly unknown.
- No requested change is smuggled into the baseline.
