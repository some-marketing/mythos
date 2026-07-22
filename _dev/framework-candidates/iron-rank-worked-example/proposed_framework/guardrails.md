# Staged Remediation Guardrails

## Dev-Only Restriction

- This framework candidate is restricted to `_dev/` incubation use.
- Do not register it in `instructions/canonical/system.yaml`.
- Do not copy it into `frameworks/` in the current phase.
- Do not expose it as a user-facing command or canonical workflow.

## Stage Execution Rules

- Execute exactly one stage per run.
- Do not advance to the next stage unless the current stage emits an explicit ready decision.
- If a stage is blocked, emit artifacts and stop. Do not silently continue.
- Only Stage 1 is executable in this candidate version. All later stages remain planned-only.

## File Modification Scope

- Modify only files explicitly allowed by the active stage definition.
- Keep framework-candidate asset changes scoped to `_dev/framework-candidates/iron-rank-worked-example/`.
- For Stage 1 remediation work, keep changes targeted to verifier, manifest, package, and test files named in the stage definition.
- Avoid broad refactors unrelated to the active stage exit criteria.

## Reporting Style

- Use observational language with evidence.
- State when an inference is being made from repo evidence.
- Separate blockers from warnings.
- Emit structured artifacts before narrative summaries.

## Determinism Rules

- Every stage must define:
  - entry criteria
  - exit criteria
  - validations
  - stop conditions
  - next-stage decision rules
- If a decision is not encoded in the stage definition or guardrails, stop and surface it as a blocker.

