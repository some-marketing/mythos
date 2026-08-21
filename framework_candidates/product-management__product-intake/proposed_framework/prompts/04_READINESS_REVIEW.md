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

1. Verify that the reviewer is distinct from the producer.
2. Test traceability from brief claims back to evidence or explicit assumptions.
3. Look for solution-first framing, missing users, contradictory constraints, and unverifiable success signals.
4. Compare the bundle with the existing blueprint/plan path for unnecessary ceremony.
5. Return `PASS`, `CONCERNS`, or `FAIL`.
6. For every concern or failure, name the missing evidence and cheapest next test.

## Outputs

- `readiness-review.json`

## Success criteria

- The verdict cites concrete artifacts.
- PASS does not authorize implementation.
- The review identifies evidence that would reverse its verdict.
