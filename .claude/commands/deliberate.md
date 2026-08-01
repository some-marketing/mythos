---
description: Run the fixed deliberation ritual: reason solo, run multi-lobe council review, then route the synthesis through orchestrate-loop for execution and closeout
mode: COORDINATOR
---

<objective>
Provide one deliberately-typed command for the full high-rigor pattern an operator can ask for explicitly: (1) the origin actor reasons on its own and writes that reasoning down, (2) a multi-lobe council reviews that reasoning, (3) the origin synthesizes one voice that names disagreement, (4) the synthesis bubbles back up through the ordinary orchestrate-loop authority surface. This command is a composition wrapper over `/convene` and `/owl`. It does not own orchestration authority, does not create a new actor or permission model, and does not mutate the shared orchestrate-loop engine that `/owl`, `/oa`, `/oc`, and `/orchestrate` inherit. Typing `/deliberate` IS the opt-in to the fixed ritual; the default loop stays threshold-gated and anti-ceremony for routine work.
</objective>

<process>
- Treat deliberate as a composition wrapper over `/convene` and `/owl`, not an independent orchestration contract.
- Resolve the alias and expansion mechanically through `instructions/canonical/command-aliases.yaml`; keep the typed alias as provenance only.
- STAGE 1 — reason solo. Normalize the request into the recursive task kernel: Current State, Question / Work, Desired State. Write the origin actor's own reasoning, the candidate routes, and the consequential assumptions down explicitly before any council fires. This is the raw signal the council reviews; do not skip it and do not collapse it into a conclusion.
- Early-exit check before any council cost. If the resolved Question / Work is a single safe deterministic step with no judgment, source-changing, governance, ambiguity, or disagreement surface, state that the council ritual is unnecessary for this target, skip to STAGE 4, and route directly through `/owl`. Do not convene by ceremony.
- STAGE 2 — council review. Run `/convene <task>` with the STAGE 1 reasoning artifact and the relevant context files attached via `--context`. `/convene` already fires the other kernel lobes (NOW/codex, OMEGA/gemini) in parallel and collects their responses, so Codex runs ONCE here by default. Do not add a separate standalone Codex bridge before convene for routine targets; that duplicates the NOW slot.
- Codex two-pass escalation is conditional, not default. Run a standalone `/dispatch-bridge --target codex` deterministic-validation pass BEFORE `/convene` only when the target is source-changing or code work, acceptance-grade implementation review, or shows suspected authority/contract drift. When the standalone pass returns CRITICAL or MAJOR findings, halt and route to repair BEFORE convening; never run the council deliberation on top of a structurally broken baseline.
- STAGE 3 — synthesize one voice. After the lobes return, write the origin-lobe analysis into the convene synthesis skeleton, synthesize across all voices into one position, and name disagreements or unresolved tensions explicitly rather than smoothing them. Held contradiction is the honest state; forced resolution is the failure mode.
- STAGE 4 — bubble up. Route through `/owl <target-or-synthesis>` so orchestrate-loop owns target resolution, actor routing, fractalization, evidence gates, review classification, and closeout. Surface to the human operator only the questions that require human judgment, protected approval, destructive or irreversible action, credential access, budget/scope/timeline commitment, client-facing risk, or same-rank authority conflict.
- When convene findings or the orchestrate-loop review lane return, classify findings by severity and type using the orchestrate-loop review decision tree before choosing the next action. CRITICAL or MAJOR blockers stop downstream advancement until durably deferred.
- Preserve all `/convene` boundaries: no canonical mutation from the convene step, no skipped synthesis, no external lobe quota on trivial questions.
- Preserve all `/owl` and `/orchestrate-loop` boundaries: actor roles, fractalization rules, evidence requirements, review lanes, debrief, and closeout ownership remain unchanged.
- Run `/debrief-run` for meaningful multi-step work before clearing, and write or update the appropriate HandoffSignal/1.0 state. Closeout ownership follows orchestrate-loop: whoever did the substantive work owns the closeout tail.
</process>

<success_criteria>
- Origin actor's solo reasoning is written down before the council fires
- Council step runs unless the target is a single safe deterministic step, in which case the skip reason is stated plainly
- Codex runs once inside convene by default; the two-pass escalation occurs only for source/code or acceptance-grade targets with an early-exit on CRITICAL/MAJOR
- Synthesis exists as one voice and names disagreements explicitly before routing continues
- Final routing occurs through `/owl` or canonical `/orchestrate-loop`, not a duplicate workflow
- Only human-judgment or protected-approval questions bubble up to the human operator
- No new permission model, actor role, or closeout path is introduced
- Shared orchestrate-loop.yaml is not mutated by introducing this command
</success_criteria>

<handoff>
ritual_warranted: STAGE 1 reason solo, then /convene <task> --context <artifacts>, then /owl <synthesis-or-target>
single_safe_step: /owl <target>
source_or_code_target: /dispatch-bridge --target codex --task "<validation task>", early-exit on CRITICAL/MAJOR, then /convene, then /owl
operator_shorthand: /dl <target-or-question>
ready_for_clear: /debrief-run <target>, then close signal or emit next stage command
</handoff>
