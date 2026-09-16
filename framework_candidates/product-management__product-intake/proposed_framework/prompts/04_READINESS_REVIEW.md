# 04 Readiness Review

## Goal
Conduct an independent evaluation of the product intake bundle. Conclude whether the initiative is ready to proceed to planning, requires bounded evidence gathering, or must be halted.

## Execution Mode
REVIEW_ONLY

## Input Context
- The scope-and-intent artifact
- The evidence ledger and hypothesis tests
- The product brief and PRFAQ

## Process
1. Document the exact actor id, harness id, and model-provider family for the current reviewing entity, as well as for every producer of the artifacts from Prompts 01-03.
2. You must refuse to issue a `PASS` verdict unless your reviewing actor id, harness id, and model-provider family are completely distinct from all producers. Using a new context window or a subagent from the same provider does not constitute a distinct reviewing mind. If provenance is missing, you must fail the review (`FAIL`).
3. Differentiate between current-run provenance observations and historical source claims. Do not invent missing identities or attempt to rewrite historical provenance.
4. Validate the traceability of claims in the product brief back to the evidence ledger or stated assumptions.
5. Scan for premature solution framing, absent user perspectives, contradictory constraints, and success signals that cannot be measured.
6. Evaluate the bundle against the existing blueprint or workflow map to identify any unnecessary process ceremony.
7. Issue a final verdict: `PASS`, `CONCERNS`, or `FAIL`.
8. For any `CONCERNS` or `FAIL` verdict, explicitly state what evidence is missing and identify the cheapest test to acquire it.

## Output Contract
- `readiness-review.json` (must include `producer_provenance` and `reviewer_provenance` to satisfy the distinct-mind check)

## Required Guardrails
- The review verdict must cite specific lines or sections from the concrete artifacts.
- The output artifact must demonstrate that the reviewer's actor, harness, and model-family are distinct from every producer.
- Any missing historical provenance must be explicitly flagged as an evidence gap, not inferred.
- A `PASS` verdict solely authorizes planning, not implementation.
- The review must name specific evidence that, if discovered, would reverse its current verdict.
