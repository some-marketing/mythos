# 03 Product Brief and PRFAQ

## Goal
Distill the validated intake and evidence into a focused product brief and a Working Backwards PRFAQ document, explicitly avoiding architectural or implementation prescriptions.

## Execution Mode
RUN_ONLY

## Input Context
- The scope-and-intent artifact
- The evidence ledger
- The hypothesis tests

## Process
1. Articulate the product opportunity and specify the exact audience that experiences the problem.
2. Describe capabilities purely as user outcomes, deliberately omitting technical implementation mechanisms.
3. Document constraints, non-goals, known assumptions, and any lingering unresolved questions.
4. Ensure every material product claim carries its relevant evidence identifier or an explicit assumption marker.
5. Formulate measurable success signals and specify the evidence required to validate them.
6. Draft a concise Working Backwards PRFAQ to stress-test customer value, potential adoption hurdles, operational impacts, and failure modes.
7. Highlight claims or hypotheses that remain too weak or uncertain to support downstream technical planning.

## Output Contract
- `product-brief.json`
- `prfaq.md`

## Required Guardrails
- The product brief must be entirely self-sufficient, requiring no external or hidden conversational context to understand.
- Product capabilities must remain strictly implementation-neutral.
- All material claims trace directly back to the evidence ledger or are flagged as explicit assumptions.
- The PRFAQ functions as an uncertainty-exposure tool, not as marketing material for the idea.
