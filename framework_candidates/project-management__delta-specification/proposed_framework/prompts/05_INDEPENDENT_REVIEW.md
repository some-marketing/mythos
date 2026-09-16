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
3. Distinguish observed current-run reviewer provenance from historical producer or source claims; do not infer missing identities or rewrite history.
4. Trace each delta to the baseline and change intent.
5. Look for hidden full-spec rewrites, lost invariants, duplicated requirements, and ambiguous removals.
6. Check consumer coverage and dependency reachability.
7. Compare the bundle with the current plan path for unnecessary ceremony.
8. Return `PASS`, `CONCERNS`, or `FAIL`, naming evidence that would reverse the verdict.

## Outputs

- `review.json`, including `producer_provenance` and `reviewer_provenance` used for the distinct-mind check

## Success criteria

- The verdict cites exact artifacts and requirement identifiers.
- The review artifact proves actor-, harness-, and model-family distinctness from every producer.
- Missing historical provenance remains a named evidence gap rather than an inferred fact.
- PASS does not authorize implementation or merging.
- Missing baseline evidence prevents acceptance.
