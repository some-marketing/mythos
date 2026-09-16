# 01 Baseline Inventory

## Goal
Create an evidence-grounded inventory of the system's current behavior prior to proposing or describing any modifications, acting as the source of truth for existing specs.

## Execution Mode
RUN_ONLY

## Input Context
- The change request or proposal
- Existing baseline sources (e.g., current specs)
- Known constraints and downstream consumers

## Process
1. Catalog all baseline sources, noting the authority and domain of each.
2. Assign a unique, stable `baseline_requirement_id` to every observable current behavior, and extract its corresponding contract surfaces.
3. Retain the source locator, revision, digest, or specific evidence identifier for each documented behavior. If provenance is unavailable, mark it explicitly.
4. Map established behaviors to their known consumers or dependent systems.
5. Surface any conflicts, stale documentation, missing factual data, or ambiguous ownership within the baseline.
6. Distinguish strictly between direct, observable behavior and interpreted intent.
7. Halt the evaluation of any proposed change if its underlying baseline behavior cannot be firmly established.

## Output Contract
- `baseline-inventory.json`

## Required Guardrails
- Every recorded baseline behavior must cite a valid source locator.
- Every behavior must preserve available source revisions or evidence identities, or explicitly name the gap in provenance.
- Each behavior must carry a unique `baseline_requirement_id` to allow downstream modifications or removals to accurately target it.
- Behaviors that are unknown must be stated as explicitly unknown.
- The baseline must remain free of any requested changes or future state semantics.
