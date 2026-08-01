---
description: Human-friendly shorthand for consult-then-route work: convene the council when judgment needs multiple lobes, then loop through owl/orchestrate-loop
mode: COORDINATOR
---

<objective>
Provide a memorable operator shorthand for the combined pattern of `/convene` plus `/owl`: first gather multi-lobe counsel when the work is materially judgment-heavy or governance-shaping, then route the synthesis through the ordinary orchestrate-loop authority surface. Council of Owls means counsel first, routing second; it does not create a new workflow, actor, or permission model.
</objective>

<process>
- Treat council-of-owls as a human-memory wrapper around the existing `/convene` and `/owl` commands, not an independent orchestration contract.
- Resolve the alias and expansion mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Normalize the request into the recursive task kernel: Current State, Question / Work, Desired State.
- Decide whether council is actually warranted. Use `/convene` for materially judgment-heavy, governance-shaping, cross-domain, high-ambiguity, or disagreement-prone work. Do not convene for routine execution, deterministic maintenance, or one safe next step.
- If council is warranted, run `/convene <task>` with the relevant context artifacts, complete the synthesis artifact, and name disagreements or unresolved tensions explicitly.
- After synthesis, route through `/owl <target-or-synthesis>` so orchestrate-loop owns target resolution, actor routing, evidence gates, review classification, and closeout.
- If council is not warranted, say that the council step is skipped and route directly through `/owl <target>`.
- Preserve all `/convene` boundaries: no canonical mutation from the convene step, no skipped synthesis, no external lobe quota on trivial questions.
- Preserve all `/owl` and `/orchestrate-loop` boundaries: actor roles, fractalization rules, evidence requirements, review lanes, and debrief closeout remain unchanged.
</process>

<success_criteria>
- Operator can use one memorable phrase for consult-then-route work
- Council step is invoked only when justified by the work shape
- When council is invoked, synthesis exists before orchestration continues
- When council is skipped, the skip reason is stated plainly
- Final routing occurs through `/owl` or canonical `/orchestrate-loop`, not a duplicate workflow
- No new permission model, actor role, or closeout path is introduced
</success_criteria>

<handoff>
council_needed: /convene <task> --context <artifacts>, then /owl <convene-synthesis-or-target>
council_not_needed: /owl <target>
formal_route: /convene when warranted; /orchestrate-loop for the loop
operator_shorthand: /council-of-owls <target-or-question>
</handoff>
