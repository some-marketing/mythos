---
name: owl
description: >
  Human-friendly alias for orchestrate-loop: Observe, Weigh, Loop.
  Use when the operator wants the memorable shorthand for /orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Treat owl as a human-memory wrapper around orchestrate-loop, not an independent workflow definition.
</prime_directive>

<objective>
Provide a memorable operator shorthand for the review-driven orchestrate-loop router without creating a second orchestration contract. Owl means Observe the current state, Weigh the question/work and best actor, then Loop through the right native route until the desired state is reached.
</objective>

<quick_start>
1. Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
2. Resolve every invocation through `instructions/canonical/commands/orchestrate-loop.yaml` and the orchestrate-loop skill at `.claude/skills/orchestrate-loop/SKILL.md`.
3. Apply the recursive task kernel exactly as orchestrate-loop does: Current State, Question / Work, Desired State.
4. Use the OWL memory cue only as operator-facing shorthand: Observe current state, Weigh the central question and best actor, Loop through the correct native route.
5. Preserve all orchestrate-loop safety gates, actor boundaries, fractalization rules, review classification, evidence requirements, and debrief/closeout behavior.
6. Do not introduce owl-specific routing, state names, artifact contracts, or default permissions.
</quick_start>

<execution_mode>
COORDINATOR. Alias to orchestrate-loop. All authority, state names, actor boundaries, and closeout behavior are owned by the orchestrate-loop skill.
</execution_mode>

<when_to_use>
Use this skill when the operator invokes `/owl` as a memorable shorthand for `/orchestrate-loop`. All target shapes, behavior, and evidence expectations are identical to orchestrate-loop.
</when_to_use>

<safety_rules>
- Never introduce owl-specific routing, state names, artifact contracts, or default permissions.
- Never interpret owl as permission to bypass human-operator gates, destructive confirmations, external publication gates, credential access gates, budget/scope commitments, or same-rank authority conflicts.
</safety_rules>

<boundaries>
- This skill does not define an independent orchestration contract.
- All canonical orchestration behavior remains owned by orchestrate-loop.
- Use `/owl` when the operator wants the memorable shorthand. Use `/orchestrate-loop` in formal specs, tests, and cross-actor handoffs.
</boundaries>

<success_criteria>
- Operators can invoke owl with the same target shapes accepted by orchestrate-loop.
- The invocation resolves to the same behavior and evidence expectations as orchestrate-loop.
- Generated command surfaces list owl as a coordinator alias.
- No duplicate orchestration contract or alternate closeout path is introduced.
</success_criteria>

<handoff>
canonical_route: /orchestrate-loop <target>
operator_shorthand: /owl <target>
formal_cross_actor_handoff: /orchestrate-loop <target>
</handoff>
</skill>
