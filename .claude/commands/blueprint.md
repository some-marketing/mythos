---
description: Take a rough request from intent to a bounded, review-gated plan: deliberate it, initialize a durable concept artifact, then route to plan-task as the terminal planning gate
mode: COORDINATOR
---

<objective>
Provide one end-user-legible command for the full blueprinting chain: (1) run the fixed deliberation ritual on the rough request so it is reasoned, council-reviewed, and synthesized into one voice, (2) initialize a durable concept artifact from that synthesis so the reasoning survives the session, (3) hand the concept off to plan-task as the terminal REVIEW_ONLY planning gate that compares it to hardened Mythos frameworks and proposes a bounded plan. `/blueprint` formally owns this three-step choreography, including artifact handoff between steps and error recovery if an earlier step fails or blocks. It does not own deliberate's, concept-init's, or plan-task's individual authority, mode, or success criteria — it sequences them and is accountable for the handoff. Terminal authority for the whole chain is pinned to plan-task: blueprint never executes a plan, it only produces one, exactly like plan-task alone would.
</objective>

<process>
- STAGE 0 — resolve and de-duplicate. Check whether the rough request already has a live concept or task-plan covering it (mirror plan-task's check-existing-work.js overlap check). If a strong owning artifact exists, resume the chain from its first incomplete step instead of restarting from STAGE 1; name this explicitly in the final report.
- STAGE 1 — deliberate. Invoke `/deliberate <rough-request>` exactly as deliberate.yaml defines it: reason solo, council-review via convene (unless the request is a single safe deterministic step), synthesize one voice that names disagreement, then route through `/owl`. Do not skip synthesis. Capture the synthesis artifact path as the STAGE 1 output.
- Error recovery — STAGE 1 failure: if deliberate cannot resolve the request, if convene returns unresolved CRITICAL/MAJOR disagreement, or if the council step is blocked, stop the chain. Do not proceed to STAGE 2 on an unsynthesized or blocked STAGE 1. Report the blocker and the exact remedy command; blueprint as a whole is 'blocked' at STAGE 1, not silently degraded to a later stage.
- STAGE 2 — concept-init. Using the STAGE 1 synthesis as source material, invoke `/concept-init <slug>` per concept-init.yaml: choose flat by default, `--bundle` when the synthesis shows cross-model dispatch or accumulated context needs. Populate Problem/Decision/Rationale/Next Steps from the STAGE 1 synthesis verbatim where possible; do not silently drop the synthesis's named disagreements. Capture the concept artifact path as the STAGE 2 output and pass it forward as STAGE 3 input.
- Error recovery — STAGE 2 failure: if concept-init cannot write the artifact (e.g. an existing concept at that slug without confirmation), stop the chain before STAGE 3. Report the STAGE 1 synthesis as already-durable evidence (it is not lost) and the exact remedy (confirm overwrite, or choose a new slug) needed to resume at STAGE 2.
- STAGE 3 — plan-task (terminal). Invoke `/plan-task <concept-path>` per plan-task.yaml, with explicit scope per its scope_enforcement rule (client vs system). plan-task owns framework similarity assessment, existing-work overlap, bounded plan generation, routing metadata, and REVIEW_ONLY proposal. This step is blueprint's terminal authority: blueprint does not execute the plan plan-task proposes, and it does not substitute its own judgment for plan-task's framework comparison or routing metadata.
- Error recovery — STAGE 3 failure: if plan-task blocks on ambiguous scope or a strong owning-plan overlap, surface that block as blueprint's terminal state (do not retry STAGE 1/2). The STAGE 1 and STAGE 2 artifacts remain valid and reusable for a corrected STAGE 3 invocation.
- Close the chain by reporting all three artifact paths (synthesis, concept, plan) and the terminal plan-task state to the operator, plus the exact next command plan-task's own handoff names (e.g. /run-plan, /review-task-plan, or operator decision on no framework match).
</process>

<success_criteria>
- Existing-artifact overlap checked before restarting the chain from STAGE 1
- STAGE 1 deliberate synthesis exists and is named as one voice before STAGE 2 begins
- STAGE 2 concept artifact exists, carries the STAGE 1 synthesis content, and its path is passed forward as STAGE 3 input
- STAGE 3 plan-task runs REVIEW_ONLY against the STAGE 2 concept artifact with explicit scope declared
- A failure or block at any stage halts the chain at that stage with a named remedy, rather than silently falling through to a later stage's defaults
- Terminal authority and final state belong to plan-task, not to blueprint itself
- Final report names all three artifact paths (synthesis, concept, plan) and the exact next command
</success_criteria>

<handoff>
chain_complete: Whatever plan-task's own handoff names: /run-plan <task-id>, /review-task-plan <task-id>, or operator decision on no framework match
stage1_blocked: Resolve the deliberate/convene blocker (see STAGE 1 error recovery), then re-invoke /blueprint <same-request>
stage2_blocked: Resolve the concept-init blocker (confirm overwrite or choose a new slug), then resume at /concept-init <slug> using the existing STAGE 1 synthesis
stage3_blocked: Resolve the plan-task scope or overlap blocker, then resume at /plan-task <concept-path> using the existing STAGE 1/2 artifacts
resume_from_existing_concept: /blueprint <concept-path-or-slug> resumes at STAGE 3 only
</handoff>
