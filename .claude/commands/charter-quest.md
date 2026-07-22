---
description: Charter a quest — take a rough request from intent to a bounded, review-gated plan
argument-hint: <rough-request | concept-path>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `blueprint` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Charter a quest: carry a rough request through the full planning chain in one motion — (1) deliberate it with `/commune` so it is reasoned, council-reviewed, and synthesized into one voice; (2) record it as a durable concept with `/inscribe-lore` so the reasoning survives the session; (3) hand the concept to `/plan-quest`, the terminal review-only planning gate that compares it to hardened grimoires and proposes a bounded quest charter. Charter-quest owns the choreography and the handoffs between steps; terminal authority for the whole chain belongs to `/plan-quest`. It never executes a plan — it only produces one.
</objective>

<process>
1. **Stage 0 — resolve and de-duplicate.** Check whether the request already has a live concept or quest charter covering it. If a strong owning artifact exists, resume the chain from its first incomplete step instead of restarting; name this in the final report.
2. **Stage 1 — deliberate.** Invoke `/commune <rough-request>`: reason solo, council-review via `/conclave` (unless the request is a single safe deterministic step), synthesize one voice that names disagreement. Capture the synthesis path as the Stage 1 output. Do not skip synthesis.
3. **Stage 1 failure recovery:** if deliberation cannot resolve the request, or the council returns unresolved CRITICAL/MAJOR disagreement, stop the chain. Do not proceed to Stage 2 on unsynthesized or blocked reasoning. Report the blocker and the exact remedy.
4. **Stage 2 — inscribe lore.** Using the Stage 1 synthesis as source, invoke `/inscribe-lore <slug>` (flat by default; a bundle when the synthesis carries accumulated cross-model context). Populate Problem/Decision/Rationale/Next Steps from the synthesis, keeping its named disagreements. Capture the concept path and pass it forward.
5. **Stage 2 failure recovery:** if the concept cannot be written (e.g. an existing concept at that slug), stop before Stage 3. The Stage 1 synthesis is already durable — report it and the exact remedy (confirm overwrite, or choose a new slug).
6. **Stage 3 — plan the quest (terminal).** Invoke `/plan-quest <concept-path>` with explicit scope (patron vs system). It owns grimoire similarity assessment, overlap checks, bounded plan generation, routing metadata, and the review-only proposal. Charter-quest does not execute or override its judgment.
7. **Stage 3 failure recovery:** if planning blocks on ambiguous scope or a strong owning-plan overlap, surface that as the terminal state. The Stage 1 and Stage 2 artifacts remain valid for a corrected Stage 3.
8. Close by reporting all three artifact paths (synthesis, concept, plan) and the terminal plan state, plus the exact next command `/plan-quest` itself names.
</process>

<success_criteria>
- Existing-artifact overlap checked before restarting from Stage 1
- Stage 1 synthesis exists as one voice before Stage 2 begins
- Stage 2 concept carries the Stage 1 content and its path feeds Stage 3
- Stage 3 runs review-only against the concept with explicit scope declared
- A failure at any stage halts the chain there with a named remedy — never a silent fall-through
- Terminal authority and final state belong to `/plan-quest`
- Final report names all three artifact paths and the exact next command
</success_criteria>

<handoff>
chain_complete: whatever /plan-quest names — /embark <task-id>, /trial-quest <task-id>, or an operator decision on no grimoire match
stage_blocked: resolve the named blocker, then resume the chain at the failed stage
resume_from_existing_concept: /charter-quest <concept-path> resumes at Stage 3 only
</handoff>
