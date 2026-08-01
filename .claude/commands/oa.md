---
description: Shortest operator alias for Owl Audit: review-first orchestration through orchestrate-loop
mode: COORDINATOR
---

<objective>
Provide a two-letter operator shorthand for audit-first orchestration without creating a separate review or execution contract. OA means Owl Audit: observe the target, classify current state, surface risks or evidence gaps, and route the next valid move through canonical `/orchestrate-loop`.
</objective>

<process>
- Treat oa as a human-memory wrapper around `/orchestrate-loop`, not an independent workflow definition.
- Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Use the OA memory cue only as operator-facing shorthand: Owl Audit means review current state, evidence, risks, and next valid route before execution.
- Preserve all `/orchestrate-loop` authority, state names, actor boundaries, fractalization rules, evidence requirements, review classification, and debrief/closeout behavior.
- Do not introduce oa-specific permissions, artifact contracts, review lanes, actors, or closeout paths.
</process>

<success_criteria>
- Operators can invoke oa with the same target shapes accepted by orchestrate-loop
- The invocation resolves to the same behavior and evidence expectations as orchestrate-loop
- Generated command surfaces list oa as a coordinator alias
- No duplicate audit, review, orchestration, or closeout contract is introduced
</success_criteria>

<handoff>
canonical_route: orchestrate-loop <target>
operator_shorthand: oa <target>
formal_cross_actor_handoff: orchestrate-loop <target>
</handoff>
