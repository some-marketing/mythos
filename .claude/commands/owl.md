---
description: Human-friendly alias for orchestrate-loop: Observe, Weigh, Loop
mode: COORDINATOR
---

<objective>
Provide a memorable operator shorthand for the review-driven orchestrate-loop router without creating a second orchestration contract. Owl means Observe the current state, Weigh the question/work and best actor, then Loop through the right native route until the desired state is reached.
</objective>

<process>
- Treat owl as a human-memory wrapper around orchestrate-loop, not an independent workflow definition.
- Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Resolve every invocation through instructions/canonical/commands/orchestrate-loop.yaml and the orchestrate-loop skill.
- Apply the recursive task kernel exactly as orchestrate-loop does: Current State, Question / Work, Desired State.
- Use the OWL memory cue only as operator-facing shorthand: Observe current state, Weigh the central question and best actor, Loop through the correct native route.
- Preserve all orchestrate-loop safety gates, actor boundaries, fractalization rules, review classification, evidence requirements, and debrief/closeout behavior.
- Do not introduce owl-specific routing, state names, artifact contracts, or default permissions.
</process>

<success_criteria>
- Operators can invoke owl with the same target shapes accepted by orchestrate-loop
- The invocation resolves to the same behavior and evidence expectations as orchestrate-loop
- Generated command surfaces list owl as a coordinator alias
- No duplicate orchestration contract or alternate closeout path is introduced
</success_criteria>

<handoff>
canonical_route: orchestrate-loop <target>
operator_shorthand: owl <target>
formal_cross_actor_handoff: orchestrate-loop <target>
</handoff>
