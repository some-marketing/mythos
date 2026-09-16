# 02 Change Proposal

## Goal
Outline the intended behavioral modifications, change boundaries, impacted consumers, and criteria for success without dictating technical implementation details (i.e., isolating the what and why from the how).

## Execution Mode
RUN_ONLY

## Input Context
- The original change request
- The baseline inventory artifact
- Project constraints and assessed risk level

## Process
1. Articulate the core intent behind the change and the specific outcome it aims to achieve.
2. Pinpoint which established baseline behaviors and downstream consumers will be affected.
3. Carry forward the supplied source locators or evidence identifiers supporting the request, the consumer impacts, and the material outcome claims. If provenance is missing, insert an explicit gap marker.
4. Document all constraints, explicit non-goals, backward-compatibility requirements, and recognized risks.
5. Establish concrete, observable success signals for the change.
6. Enumerate any unresolved questions regarding the baseline or affected consumers.
7. Choose between Lite or Full specification depth based on the initiative's risk profile and ambiguity level.

## Output Contract
- `change-proposal.json`

## Required Guardrails
- Intent and expected behavior must be strictly separated from implementation mechanics.
- All material claims regarding intent or consumer impact must carry an evidence reference or an explicit gap tag.
- The proposal must identify any consumers or systems that could suffer harm if the delta is implemented incorrectly.
- The choice of specification depth (Lite vs. Full) must be actively justified, not chosen by default.
