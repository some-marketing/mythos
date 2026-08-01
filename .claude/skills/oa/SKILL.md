---
name: oa
description: >
  Shortest operator alias for Owl Audit: review-first orchestration through
  orchestrate-loop. Observe, classify current state, surface risks or evidence
  gaps, then route through canonical orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Treat oa as an alias to orchestrate-loop with an audit-first posture, not an independent workflow definition.
</prime_directive>

<objective>
Provide the shortest operator shorthand for review-first orchestration. OA means Owl Audit — review current state, evidence, risks, and next valid route before execution. All authority remains with orchestrate-loop.
</objective>

<quick_start>
1. Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
2. Resolve every invocation through `instructions/canonical/commands/orchestrate-loop.yaml` and the orchestrate-loop skill at `.claude/skills/orchestrate-loop/SKILL.md`.
3. Apply the recursive task kernel exactly as orchestrate-loop does: Current State, Question / Work, Desired State.
4. Use the OA memory cue: Owl Audit — review current state, evidence, risks, and next valid route before execution.
5. Preserve all orchestrate-loop safety gates, actor boundaries, fractalization rules, review classification, evidence requirements, and debrief/closeout behavior.
6. Do not introduce oa-specific permissions, artifact contracts, review lanes, actors, or closeout paths.
</quick_start>

<execution_mode>
COORDINATOR. Alias to orchestrate-loop with audit-first posture. All authority, state names, actor boundaries, and closeout behavior are owned by the orchestrate-loop skill.
</execution_mode>

<when_to_use>
Use this skill when the operator invokes `/oa` as the shortest shorthand for review-first orchestration. All target shapes, behavior, and evidence expectations are identical to orchestrate-loop.
</when_to_use>

<safety_rules>
- Never introduce oa-specific permissions, artifact contracts, review lanes, actors, or closeout paths.
- Never interpret oa as permission to bypass human-operator gates, destructive confirmations, external publication gates, credential access gates, budget/scope commitments, or same-rank authority conflicts.
</safety_rules>

<boundaries>
- This skill does not define an independent orchestration contract.
- All canonical orchestration behavior remains owned by orchestrate-loop.
- Use `/oa` when the operator wants the shortest audit-first shorthand. Use `/orchestrate-loop` in formal specs, tests, and cross-actor handoffs.
- The audit-first posture means: classify state, surface risks and evidence gaps, then route — not execute blindly.
</boundaries>

<success_criteria>
- Operators can invoke oa with the same target shapes accepted by orchestrate-loop.
- The invocation resolves to the same behavior and evidence expectations as orchestrate-loop.
- Generated command surfaces list oa as a coordinator alias with audit-first posture.
- No duplicate orchestration contract or alternate closeout path is introduced.
</success_criteria>

<handoff>
audit_first_shorthand: /oa <target>
general_orchestration: /owl <target>
formal_cross_actor_handoff: /orchestrate-loop <target>
</handoff>
</skill>
