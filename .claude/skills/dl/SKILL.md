---
name: dl
description: >
  Shortest operator alias for deliberate: reason solo, council review,
  synthesize, then route through orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Treat dl as an alias to deliberate, not an independent workflow definition.
</prime_directive>

<objective>
Provide the shortest operator shorthand for the deliberation ritual. DL means deliberate — reason solo, run multi-lobe council review via convene, synthesize one voice, then route through owl/orchestrate-loop. All authority remains with deliberate, convene, and orchestrate-loop.
</objective>

<quick_start>
1. Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
2. Resolve every invocation through `instructions/canonical/commands/deliberate.yaml` and the deliberate skill at `.claude/skills/deliberate/SKILL.md`.
3. Preserve the deliberate boundary: reason solo first, run convene for council review, synthesize one voice naming disagreements, then route through owl or canonical orchestrate-loop.
4. Do not introduce dl-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
</quick_start>

<execution_mode>
COORDINATOR. Alias to deliberate. All authority, stages, the early-exit rule, and boundaries are owned by deliberate, convene, and orchestrate-loop.
</execution_mode>

<when_to_use>
Use this skill when the operator invokes `/dl` as the shortest shorthand for deliberate. All target shapes, behavior, and evidence expectations are identical to deliberate.
</when_to_use>

<safety_rules>
- Never introduce dl-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
- Never interpret dl as permission to bypass human-operator gates, destructive confirmations, external publication gates, credential access gates, budget/scope commitments, or same-rank authority conflicts.
</safety_rules>

<boundaries>
- This skill does not define an independent orchestration contract.
- All canonical deliberation behavior remains owned by deliberate.
- All canonical consultation behavior remains owned by convene.
- All canonical orchestration behavior remains owned by orchestrate-loop.
- Use `/dl` when the operator wants the shortest deliberation shorthand. Use `/deliberate` in formal specs, tests, and cross-actor handoffs.
</boundaries>

<success_criteria>
- Operators can invoke dl with the same target shapes accepted by deliberate.
- The invocation resolves to the same behavior and evidence expectations as deliberate.
- Generated command surfaces list dl as a coordinator alias.
- No duplicate orchestration contract or alternate closeout path is introduced.
</success_criteria>

<handoff>
canonical_route: /deliberate <target-or-question>
operator_shorthand: /dl <target-or-question>
formal_cross_actor_handoff: /deliberate <target-or-question>
</handoff>
</skill>
