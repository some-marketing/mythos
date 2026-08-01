---
name: council-of-owls
description: >
  Human-friendly shorthand for consult-then-route work: convene the council
  when judgment needs multiple lobes, then loop through owl/orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Council of Owls = consult-then-route. Convene the council when judgment needs multiple lobes, then loop through owl/orchestrate-loop. This skill owns only the consultation-then-routing sequencing contract.
</prime_directive>

<objective>
Provide a consult-then-route workflow for Mythos. The skill decides whether multi-lobe counsel is warranted, runs convene when it is, synthesizes across voices, and routes through orchestrate-loop. It does not own orchestration authority.
</objective>

<quick_start>
1. Normalize the request into the recursive task kernel: Current State, Question / Work, Desired State.
2. Decide whether council is warranted. Use convene when the work is materially judgment-heavy, governance-shaping, cross-domain, high-ambiguity, or disagreement-prone. Do not convene for routine execution, deterministic maintenance, or one safe next step.
3. If council is warranted: run convene with the relevant context artifacts, complete the synthesis artifact, and name disagreements or unresolved tensions explicitly. After synthesis, route through owl/orchestrate-loop.
4. If council is NOT warranted: state that the council step is skipped and why. Then route directly through owl/orchestrate-loop.
5. Preserve all convene boundaries: no canonical mutation from the convene step, no skipped synthesis, no external lobe quota on trivial questions.
6. Preserve all owl and orchestrate-loop boundaries: actor roles, fractalization rules, evidence requirements, review lanes, and debrief closeout remain unchanged.
</quick_start>

<execution_mode>
COORDINATOR. This skill routes work through convene and then through orchestrate-loop. It does not own orchestration authority and does not mutate the shared orchestrate-loop engine.
</execution_mode>

<when_to_use>
Use this skill when the work involves:
- materially judgment-heavy questions
- governance-shaping decisions
- cross-domain synthesis
- high-ambiguity situations
- disagreement-prone topics

Do not use this skill for routine execution, deterministic maintenance, or one safe next step.
</when_to_use>

<safety_rules>
- Never convene by ceremony for routine or deterministic work.
- Never skip synthesis when convene was warranted.
- Never mutate canonical state from the convene step.
- Never introduce council-of-owls-specific permissions, artifact contracts, review lanes, actors, or closeout paths.
</safety_rules>

<boundaries>
- Canonical consultation behavior: owned by convene.
- Canonical orchestration behavior: owned by orchestrate-loop, with owl as the human shorthand.
- Use council-of-owls when the operator asks for counsel plus routing.
- Use convene directly when only multi-lobe synthesis is requested.
- Use owl directly when orchestration is needed and council would be ceremony.
- This skill does not replace orchestrate-loop; it complements it as the consultation-then-routing controller.
</boundaries>

<success_criteria>
- Council runs only when warranted (judgment-heavy, governance-shaping, cross-domain, high-ambiguity, or disagreement-prone).
- Council is skipped with stated reason when not warranted.
- Synthesis names disagreements explicitly before routing continues.
- Final routing through owl or orchestrate-loop, not a duplicate workflow.
- Only human-judgment / protected-approval questions bubble up.
- No new permission model, actor role, or closeout path introduced.
</success_criteria>

<handoff>
council_needed: /convene <task>, then /owl <synthesis-or-target>
council_not_needed: /owl <target>
operator_shorthand: /oc <target-or-question>
formal_route: /convene when warranted; /orchestrate-loop for the loop
</handoff>
</skill>
