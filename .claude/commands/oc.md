---
description: Shortest operator alias for council-of-owls: Owl Council
mode: COORDINATOR
---

<objective>
Provide a two-letter operator shorthand for `/council-of-owls` without creating a second consultation or orchestration contract. OC means Owl Council: consult with `/convene` when council is warranted, then route through `/owl` and canonical `/orchestrate-loop`.
</objective>

<process>
- Treat oc as a human-memory wrapper around `/council-of-owls`, not an independent workflow definition.
- Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- Resolve every invocation through `instructions/canonical/commands/council-of-owls.yaml`.
- Preserve the council-of-owls boundary: use `/convene` only when multi-lobe counsel is warranted, then route through `/owl` or canonical `/orchestrate-loop`.
- Do not introduce oc-specific routing, state names, artifact contracts, review lanes, actors, or permissions.
</process>

<success_criteria>
- Operators can invoke oc with the same target shapes accepted by council-of-owls
- The invocation resolves to the same behavior and evidence expectations as council-of-owls
- Generated command surfaces list oc as a coordinator alias
- No duplicate consultation, orchestration, or closeout contract is introduced
</success_criteria>

<handoff>
canonical_route: council-of-owls <target-or-question>
operator_shorthand: oc <target-or-question>
formal_cross_actor_handoff: council-of-owls <target-or-question>
</handoff>
