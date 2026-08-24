# 02 Discovery Evidence

## Objective

Build a provenance-aware evidence ledger and identify the cheapest checks that distinguish the main product hypotheses.

## Mode

RUN_ONLY

## Inputs

- Scope-and-intent artifact
- Supplied research, observations, feedback, and prior artifacts

## Steps

1. Inventory every supplied evidence item and its authority.
2. Classify each material statement as observation, stakeholder claim, interpretation, assumption, or open question.
3. Identify contradictory evidence, missing user perspectives, and likely source drift.
4. Record at least two plausible explanations for the reported problem where evidence permits.
5. Name the cheapest falsifier for each material product hypothesis.
6. Stop rather than filling missing evidence with inference.

## Outputs

- `evidence-ledger.json`
- `hypothesis-tests.json`

## Success criteria

- Every product claim has provenance or an explicit evidence gap.
- The ledger distinguishes confidence from authority.
- Proposed evidence actions are bounded and non-destructive.
