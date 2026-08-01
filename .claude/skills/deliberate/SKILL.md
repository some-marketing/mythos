---
name: deliberate
description: >
  Run the fixed deliberation ritual: reason solo, multi-lobe council review,
  synthesize, then route through orchestrate-loop.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Run the fixed deliberation ritual: reason solo, council review, synthesize, then route through orchestrate-loop. This skill owns only the sequencing contract. It does not own orchestration authority.
</prime_directive>

<objective>
Provide a deliberately-typed high-rigor ritual for Mythos. The skill runs the full pattern: reason solo, convene for council review, synthesize one voice naming disagreements, then route through owl/orchestrate-loop. It owns only the sequencing contract.
</objective>

<quick_start>
1. Resolve the alias mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only. Resolve authority through `instructions/canonical/commands/deliberate.yaml`.
2. STAGE 1 — reason solo. Normalize into the recursive task kernel: Current State, Question / Work, Desired State. Write the origin actor's reasoning, candidate routes, and consequential assumptions down before any council fires.
3. Early-exit check. If the resolved Question / Work is a single safe deterministic step with no judgment, source-changing, governance, ambiguity, or disagreement surface, state that the ritual is unnecessary, skip to STAGE 4, and route through owl. Do not convene by ceremony.
4. STAGE 2 — council review. Run convene with the STAGE 1 reasoning and context attached. Do not add a separate standalone Codex bridge before convene for routine targets — that duplicates the NOW slot.
5. Codex two-pass escalation (conditional). Run a standalone dispatch-bridge --target codex deterministic-validation pass BEFORE convene only for source-changing / code work, acceptance-grade implementation review, or suspected authority/contract drift. If that pass returns CRITICAL or MAJOR, halt and route to repair BEFORE convening.
6. STAGE 3 — synthesize one voice. Read the artifact directory, write the origin-lobe analysis into the skeleton, synthesize across all voices, name disagreements explicitly, and rename to synthesis.md. Held contradiction is the honest state; forced resolution is the failure mode.
7. STAGE 4 — bubble up. Route through owl so orchestrate-loop owns target resolution, actor routing, fractalization, evidence gates, review classification, and closeout.
8. Classify any returned findings by severity and type using the orchestrate-loop review decision tree.
9. Preserve all convene boundaries and all owl / orchestrate-loop boundaries.
10. Run debrief-run for meaningful multi-step work before clearing, and write/update the appropriate HandoffSignal/1.0 state.
</quick_start>

<execution_mode>
COORDINATOR. This skill sequences convene and orchestrate-loop. It does not own orchestration authority and does not mutate the shared orchestrate-loop engine inherited by owl, oa, oc, orchestrate.
</execution_mode>

<when_to_use>
Use this skill when the operator wants the full deliberation ritual every time, regardless of the orchestrate-loop anti-ceremony default. Use for governance-shaping, high-ambiguity, or disagreement-prone work.
</when_to_use>

<safety_rules>
- Never convene by ceremony for routine or deterministic work.
- Never skip synthesis when convene was warranted.
- Never mutate canonical state from the convene step.
- Never run destructive operations from this skill.
- Never advance downstream stages while unresolved or undeferred CRITICAL or MAJOR findings remain.
</safety_rules>

<boundaries>
- This skill owns only the sequencing contract: reason solo → council → synthesize → route.
- Canonical consultation behavior: owned by convene.
- Canonical orchestration behavior: owned by orchestrate-loop.
- Use deliberate when the operator wants the full ritual. Use owl directly when orchestration is needed and deliberation would be ceremony.
- This skill does not replace orchestrate-loop; it complements it as the high-rigor deliberation controller.
</boundaries>

<success_criteria>
- Origin actor's solo reasoning written down before the council fires.
- Council runs unless the target is a single safe deterministic step (skip reason stated).
- Codex runs once inside convene by default; two-pass escalation only for source/code or acceptance-grade targets, with early-exit on CRITICAL/MAJOR.
- Synthesis is one voice and names disagreements before routing continues.
- Final routing through owl or orchestrate-loop, not a duplicate workflow.
- Only human-judgment / protected-approval questions bubble up.
- No new permission model, actor role, or closeout path; shared orchestrate-loop.yaml not mutated.
</success_criteria>

<handoff>
ritual_warranted: STAGE 1 reason solo, then /convene <task> --context <artifacts>, then /owl <synthesis-or-target>
single_safe_step: /owl <target>
source_or_code_target: /dispatch-bridge --target codex (validate), early-exit on CRITICAL/MAJOR, then /convene, then /owl
operator_shorthand: /dl <target-or-question>
ready_for_clear: /debrief-run <target>, then close signal or emit next stage command
</handoff>
</skill>
