# 04 Stage 1 Completion Audit And Next Stage Decision

## Objective

Audit completion for Stage 1 and emit the deterministic handoff artifacts required before any later stage may begin.

## Mode

REVIEW_ONLY

## Inputs

- `artifacts/stage_status.json`
- `artifacts/validation_results.json`
- Stage 1 exit criteria

## Steps

1. Compare the final repo state and validation evidence to the Stage 1 acceptance criteria.
2. Classify findings as blockers, warnings, or informational notes.
3. Decide whether Stage 1 is complete, blocked, or requires reopen.
4. Emit the next-stage decision artifact.
5. Write a completion audit report that states whether Stage 2 may begin.

## Outputs

- `artifacts/next_stage_decision.json`
- `reports/COMPLETION_AUDIT.md`

## Success Criteria

- The next-stage decision is explicit and evidence-based.
- Deferred work is separated from blockers.
- The workflow stops cleanly after Stage 1.

## Guardrails

- Do not advance to later stages inside this prompt.
- If evidence is incomplete, recommend reopen instead of guessing.

