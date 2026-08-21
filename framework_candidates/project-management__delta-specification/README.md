# project-management__delta-specification

Iron research candidate synthesized from the OpenSpec delta-spec pattern through the χ evidence loop, with GSD dependency-wave planning retained as comparative hardening.

## What it is

A reports/review-only workflow that describes a brownfield change as explicit added, modified, and removed requirements with scenarios, dependencies, acceptance criteria, and an independent readiness review.

## Candidate boundary

- This is not OpenSpec or GSD Core and does not copy their code, installers, telemetry, hooks, or surrounding architecture.
- The reusable import unit is behavior-level delta specification.
- Initial execution modes are `RUN_ONLY` for contracted report artifacts and `REVIEW_ONLY` for the independent verdict.
- Promotion requires replay evidence, independent review, sanitization, operator feedback, and the normal rank gate.
- The included replay record is a structural preflight only; it is not evidence that the prompt chain has run successfully.

## Start here

- `candidate.json` — current maturity and blockers
- `evidence/` — χ provenance and transfer rationale
- `proposed_framework/` — draft framework
- `replay_cases/neutral-retention-change/` — bounded replay seed
- `learning/` — feedback and system-signal ledger
