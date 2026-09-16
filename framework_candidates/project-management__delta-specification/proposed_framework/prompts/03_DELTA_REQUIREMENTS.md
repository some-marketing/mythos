# 03 Delta Requirements

## Goal
Translate the change proposal into concrete, behavior-level delta specifications—explicitly detailing ADDED, MODIFIED, and REMOVED requirements alongside observable scenarios.

## Execution Mode
RUN_ONLY

## Input Context
- The baseline inventory
- The change proposal

## Process
1. Before generating `delta-spec.json`, explicitly read the schema at `schemas/output/delta-spec.schema.json` relative to the candidate framework root.
2. Formulate each new (ADDED) requirement and provide at least one observable scenario.
3. Append the supporting source locator or evidence identifier to every added requirement and scenario. If a requirement lacks support, mark it as an evidence gap.
4. For every MODIFIED requirement, explicitly cite its `baseline_requirement_id` and detail the exact difference in observable behavior.
5. For every REMOVED requirement, cite the baseline requirement and provide the rationale for its intended deprecation or absence.
6. Apply RFC 2119 keywords (MUST, SHOULD, MAY) with strict consistency to indicate the strength of each requirement.
7. Document any critical system invariants that this delta must leave unchanged.
8. Highlight any merge ambiguities, conflicting requirements, or elements that lack adequate evidence backing.

## Authoritative Output Shapes
The output must conform exactly to the supplied schema, enforcing the following object shapes:
- **ADDED Requirement**: Must contain `requirement_id`, `requirement`, `provenance`, and `scenarios`.
- **MODIFIED Requirement**: Must contain `requirement_id`, `baseline_requirement_id`, `behavioral_difference`, `requirement`, `provenance`, and `scenarios`.
- **REMOVED Requirement**: Must contain `requirement_id`, `baseline_requirement_id`, `intended_absence`, and `provenance`. REMOVED entries carry requirement-level provenance and do not take scenarios.
- **Scenarios**: For ADDED and MODIFIED requirements, scenarios must be objects with `text` and `provenance`, not legacy strings. Legacy string scenarios are not a compatibility form.
- **Provenance**: `provenance.status` must be exactly `source` or `evidence_gap`. `provenance.reference` must be nonblank and non-whitespace.

## Output Contract
- `delta-spec.json`

## Required Guardrails
- ADDED, MODIFIED, and REMOVED sections must be strictly separated and impossible to conflate.
- Every requirement must describe externally observable, testable behavior rather than internal logic.
- Every requirement and scenario must be grounded in a source citation or explicitly flagged as an evidence gap if unsupported.
- Unchanged invariants that must be protected during implementation are visibly declared.
