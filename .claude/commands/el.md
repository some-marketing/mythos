---
description: Shortest operator alias for Evidence Loop: distinct-family review, context checking, research disposition, and iterative re-entry
mode: COORDINATOR
---

<objective>
Provide a two-letter operator shorthand for `/evidence-loop` without creating a separate workflow, authority surface, or lifecycle state.
</objective>

<process>
- Treat el as a human-memory wrapper around `/evidence-loop`, not an independent workflow definition.
- Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Preserve every Evidence Loop activation rule, actor boundary, finding-ledger requirement, privacy disposition, iteration ceiling, and closeout rule.
- Preserve `/orchestrate-loop` as the sole lifecycle controller.
- Do not introduce el-specific permissions, artifacts, review lanes, actors, state names, or closeout paths.
</process>

<success_criteria>
- The alias accepts the same target shapes as evidence-loop
- The alias resolves mechanically to evidence-loop on generated and managed command surfaces
- No duplicate orchestration or evidence contract is introduced
</success_criteria>

<handoff>
operator_shorthand: el <target-or-work>
canonical_profile: evidence-loop <target-or-work>
lifecycle_controller: orchestrate-loop <target-or-work>
</handoff>
