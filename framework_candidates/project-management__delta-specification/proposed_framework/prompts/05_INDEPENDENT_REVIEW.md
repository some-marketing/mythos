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

1. Record the actor id, harness id, and model-provider family for the reviewer and every producer of Prompts 01–04.
2. Refuse to issue `PASS` unless the reviewer actor id, harness id, and model-provider family are all distinct from every producer. A new context or same-provider subagent is not a distinct reviewing mind; missing provenance forces `FAIL`.
3. Trace each delta to the baseline and change intent.
4. Look for hidden full-spec rewrites, lost invariants, duplicated requirements, and ambiguous removals.
5. Check consumer coverage and dependency reachability.
6. Compare the bundle with the current plan path for unnecessary ceremony.
7. Return `PASS`, `CONCERNS`, or `FAIL`, naming evidence that would reverse the verdict.

## Outputs

- `review.json`, including `producer_provenance` and `reviewer_provenance` used for the distinct-mind check

## Success criteria

- The verdict cites exact artifacts and requirement identifiers.
- The review artifact proves actor-, harness-, and model-family distinctness from every producer.
- PASS does not authorize implementation or merging.
- Missing baseline evidence prevents acceptance.
