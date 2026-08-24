# 04 Readiness Review

## Objective

Independently review the intake bundle and decide whether it is ready for planning, needs a bounded evidence action, or should stop.

## Mode

REVIEW_ONLY

## Inputs

- Scope-and-intent artifact
- Evidence ledger and hypothesis tests
- Product brief and PRFAQ

## Steps

1. Record the actor id, harness id, and model-provider family for the reviewer and every producer of Prompts 01–03.
2. Refuse to issue `PASS` unless the reviewer actor id, harness id, and model-provider family are all distinct from every producer. A new context or same-provider subagent is not a distinct reviewing mind; missing provenance forces `FAIL`.
3. Test traceability from brief claims back to evidence or explicit assumptions.
4. Look for solution-first framing, missing users, contradictory constraints, and unverifiable success signals.
5. Compare the bundle with the existing blueprint/plan path for unnecessary ceremony.
6. Return `PASS`, `CONCERNS`, or `FAIL`.
7. For every concern or failure, name the missing evidence and cheapest next test.

## Outputs

- `readiness-review.json`, including `producer_provenance` and `reviewer_provenance` used for the distinct-mind check

## Success criteria

- The verdict cites concrete artifacts.
- The review artifact proves actor-, harness-, and model-family distinctness from every producer.
- PASS does not authorize implementation.
- The review identifies evidence that would reverse its verdict.
