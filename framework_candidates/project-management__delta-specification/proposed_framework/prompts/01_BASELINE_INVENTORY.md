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
2. Extract observable current behaviors and contract surfaces.
3. Map each behavior to known consumers.
4. Identify conflicts, stale sources, missing facts, and ambiguous ownership.
5. Separate direct observations from interpretations.
6. Halt any proposed delta whose baseline cannot be established.

## Outputs

- `baseline-inventory.json`

## Success criteria

- Every baseline behavior cites a source locator.
- Unknown behavior remains explicitly unknown.
- No requested change is smuggled into the baseline.
