# 02 Discovery Evidence

## Goal
Compile a strict, provenance-aware evidence ledger from the intake materials. Determine the most cost-effective checks or falsifiers to test the primary product hypotheses.

## Execution Mode
RUN_ONLY

## Input Context
- The generated scope-and-intent artifact
- All provided research, user feedback, observations, and previous planning artifacts

## Process
1. Catalog every piece of supplied evidence, noting its source and authority.
2. Allocate a stable evidence identifier to each item. Maintain its source locator, digest, or revision if provided.
3. Categorize every material statement: is it an observation, a stakeholder claim, an interpretation, an assumption, or an open question?
4. Pinpoint any contradictory evidence, perspectives missing from intended users, and areas of likely source drift.
5. Document at least two distinct, plausible explanations for the observed problem, provided the evidence supports them.
6. Define the cheapest, most direct falsifying test for each material product hypothesis.
7. Terminate the process if crucial evidence is missing, rather than bridging gaps with fabricated inference.

## Output Contract
- `evidence-ledger.json`
- `hypothesis-tests.json`

## Required Guardrails
- Every product claim must carry explicit provenance or be marked as an evidence gap.
- Every evidence entry must retain its origin or bear an explicit unavailable-provenance tag.
- The ledger must clearly separate the confidence of a claim from the authority of its source.
- Proposed tests and evidence actions must be bounded, safe, and non-destructive.
