# 05 Independent Review

## Objective

Independently test the delta bundle for baseline errors, contradictory semantics, uncovered consumers, and unverifiable acceptance claims.

## Mode

REVIEW_ONLY

## Inputs

- Baseline inventory
- Change proposal
- Delta requirements
- Dependency and acceptance map

## Steps

1. Verify that the reviewer is distinct from the producer.
2. Trace each delta to the baseline and change intent.
3. Look for hidden full-spec rewrites, lost invariants, duplicated requirements, and ambiguous removals.
4. Check consumer coverage and dependency reachability.
5. Compare the bundle with the current plan path for unnecessary ceremony.
6. Return `PASS`, `CONCERNS`, or `FAIL`, naming evidence that would reverse the verdict.

## Outputs

- `review.json`

## Success criteria

- The verdict cites exact artifacts and requirement identifiers.
- PASS does not authorize implementation or merging.
- Missing baseline evidence prevents acceptance.
