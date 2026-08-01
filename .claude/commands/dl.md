---
description: Shortest operator alias for deliberate: reason solo, council-review, synthesize, then route through orchestrate-loop
mode: COORDINATOR
---

<objective>
Provide a two-letter operator shorthand for `/deliberate` without creating a second consultation or orchestration contract. DL means deliberate: reason on your own, run the multi-lobe council review, synthesize one voice, then route the synthesis through `/owl` and canonical `/orchestrate-loop`.
</objective>

<process>
- Treat dl as a human-memory wrapper around `/deliberate`, not an independent workflow definition.
- Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Resolve every invocation through `instructions/canonical/commands/deliberate.yaml`.
- Preserve the deliberate boundary: reason solo first, run `/convene` for council review (Codex once by default), synthesize one voice naming disagreements, then route through `/owl` or canonical `/orchestrate-loop`.
- Do not introduce dl-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
</process>

<success_criteria>
- Operators can invoke dl with the same target shapes accepted by deliberate
- The invocation resolves to the same behavior and evidence expectations as deliberate
- Generated command surfaces list dl as a coordinator alias
- No duplicate consultation, orchestration, or closeout contract is introduced
</success_criteria>

<handoff>
canonical_route: deliberate <target-or-question>
operator_shorthand: dl <target-or-question>
formal_cross_actor_handoff: deliberate <target-or-question>
</handoff>
