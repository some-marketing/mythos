---
name: oc
description: >
  Shortest operator alias for council-of-owls: Owl Council. Convene multi-lobe
  counsel when warranted, then route through owl/orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Treat oc as an alias to council-of-owls, not an independent workflow definition.
</prime_directive>

<objective>
Provide the shortest operator shorthand for consult-then-route work. OC means Owl Council — convene multi-lobe counsel when warranted, then route through owl/orchestrate-loop. All authority remains with council-of-owls and orchestrate-loop.
</objective>

<quick_start>
1. Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
2. Resolve every invocation through `instructions/canonical/commands/council-of-owls.yaml` and the council-of-owls skill at `.claude/skills/council-of-owls/SKILL.md`.
3. Use the OC memory cue: Owl Council — convene when warranted, then route through owl/orchestrate-loop.
4. Preserve all council-of-owls boundaries: use convene only when multi-lobe counsel is warranted, then route through owl or canonical orchestrate-loop.
5. Do not introduce oc-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
</quick_start>

<execution_mode>
COORDINATOR. Alias to council-of-owls. All authority, state names, actor boundaries, and closeout behavior are owned by council-of-owls and orchestrate-loop.
</execution_mode>

<when_to_use>
Use this skill when the operator invokes `/oc` as the shortest shorthand for council-of-owls. All target shapes, behavior, and evidence expectations are identical to council-of-owls.
</when_to_use>

<safety_rules>
- Never introduce oc-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
- Never interpret oc as permission to bypass human-operator gates, destructive confirmations, external publication gates, credential access gates, budget/scope commitments, or same-rank authority conflicts.
</safety_rules>

<boundaries>
- This skill does not define an independent orchestration contract.
- All canonical consultation behavior remains owned by convene.
- All canonical orchestration behavior remains owned by orchestrate-loop, with owl as the human shorthand.
- Use `/oc` when the operator wants the shortest council shorthand. Use `/council-of-owls` in formal specs, tests, and cross-actor handoffs.
</boundaries>

<success_criteria>
- Operators can invoke oc with the same target shapes accepted by council-of-owls.
- The invocation resolves to the same behavior and evidence expectations as council-of-owls.
- Generated command surfaces list oc as a coordinator alias.
- No duplicate orchestration contract or alternate closeout path is introduced.
</success_criteria>

<handoff>
operator_shorthand: /oc <target-or-question>
council_needed: /convene <target>, then /owl <synthesis>
council_not_needed: /owl <target>
formal_cross_actor_handoff: /council-of-owls <target>
</handoff>
</skill>
