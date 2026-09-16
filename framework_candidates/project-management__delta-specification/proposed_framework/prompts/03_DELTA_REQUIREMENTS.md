# 03 Delta Requirements

## Goal
Translate the change proposal into concrete, behavior-level delta specifications—explicitly detailing ADDED, MODIFIED, and REMOVED requirements alongside observable scenarios.

## Execution Mode
RUN_ONLY

## Input Context
- The baseline inventory
- The change proposal

## Process
1. Formulate each new (ADDED) requirement and provide at least one observable scenario.
2. Append the supporting source locator or evidence identifier to every added requirement and scenario. If a requirement lacks support, mark it as an evidence gap.
3. For every MODIFIED requirement, explicitly cite its `baseline_requirement_id` and detail the exact difference in observable behavior.
4. For every REMOVED requirement, cite the baseline requirement and provide the rationale for its intended deprecation or absence.
5. Apply RFC 2119 keywords (MUST, SHOULD, MAY) with strict consistency to indicate the strength of each requirement.
6. Document any critical system invariants that this delta must leave unchanged.
7. Highlight any merge ambiguities, conflicting requirements, or elements that lack adequate evidence backing.

## Output Contract
- `delta-spec.json`

## Required Guardrails
- ADDED, MODIFIED, and REMOVED sections must be strictly separated and impossible to conflate.
- Every requirement must describe externally observable, testable behavior rather than internal logic.
- Every requirement and scenario must be grounded in a source citation or explicitly flagged as unsupported.
- Unchanged invariants that must be protected during implementation are visibly declared.
