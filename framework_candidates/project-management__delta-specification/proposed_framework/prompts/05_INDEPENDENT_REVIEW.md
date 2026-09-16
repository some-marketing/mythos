# 05 Independent Review

## Goal
Perform an isolated, independent audit of the complete delta bundle to identify baseline inaccuracies, semantic contradictions, ignored consumers, and acceptance claims that cannot be verified.

## Execution Mode
REVIEW_ONLY

## Input Context
- The baseline inventory
- The change proposal
- The delta requirements
- The dependency and acceptance map

## Process
1. Log the exact actor id, harness id, and model-provider family for the reviewing entity, as well as for all producers responsible for Prompts 01-04.
2. Refuse to grant a `PASS` verdict unless the reviewer's actor id, harness id, and model-provider family are demonstrably distinct from every producer. A subagent from the same provider or a wiped context window does not satisfy the distinct reviewing mind requirement. Absent provenance must trigger a `FAIL`.
3. Separate current-run reviewer provenance from historical source claims; do not attempt to deduce missing identities or rewrite history.
4. Verify that each delta requirement traces coherently back to the baseline and the proposed change intent.
5. Scan for stealth rewrites of the full spec, dropped invariants, redundant requirements, and removals that lack clear justification.
6. Audit the bundle to ensure all affected consumers are covered and that dependency paths are fully reachable.
7. Contrast the delta bundle with the established project planning path to flag any excessive or unnecessary ceremony.
8. Render a final verdict of `PASS`, `CONCERNS`, or `FAIL`, explicitly specifying the evidence that would be required to reverse the decision.

## Output Contract
- `review.json` (must include `producer_provenance` and `reviewer_provenance` to validate the distinct-mind check)

## Required Guardrails
- The review verdict must explicitly reference concrete artifacts and specific requirement identifiers.
- The output artifact must provide proof that the reviewer is distinct (actor, harness, and model-family) from every producer.
- Missing historical provenance must be explicitly stated as an evidence gap rather than inferred.
- A `PASS` verdict does not authorize code implementation or repository merging.
- Any lack of evidence in the baseline inventory immediately prevents acceptance.
