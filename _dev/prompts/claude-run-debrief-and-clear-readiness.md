# Claude Run Prompt: Debrief And Clear Readiness

Use this as the concrete execution prompt for ending a larger Claude-authored implementation sequence in Mythos where multiple frameworks, commands, prompt packs, workflows, or overarching system flows came together and now need an integrated debrief packet, post-session learning capture, code validation, and an explicit recommendation to run `clear` only when the full sequence is actually safe to clear.

```text
Finish the current larger implementation sequence in Mythos by producing a debrief packet, capturing post-session learning when warranted, running the right integrated code validation, and only then deciding whether the sequence is ready for `clear`.

Read these inputs first:
- the artifacts, changed files, and reports produced by the just-completed sequence
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`
- `_dev/SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md`
- `_dev/prompts/claude-prompt-pack-master-prompt-and-operator-ux-hardening.md`
- `_dev/prompts/claude-prompt-pack-source-material-qa-and-promotion.md`
- `instructions/canonical/guardrails.md`
- any command docs or prompt packs materially changed during the sequence

Goal:
- produce a complete debrief packet for the sequence
- capture interaction/learning feedback when the sequence exposed reusable lessons
- run code validation appropriate to the actual changed surfaces and workflow intersections
- surface any uncodified action items revealed by the sequence
- emit `ready_for_clear` only after the debrief, reflection, and validation obligations are satisfied
- explicitly recommend `clear` when the sequence is truly safe to clear

Required output order:
1. Debrief packet
2. Lessons summary
3. Uncodified action items
4. Code-validation summary
5. Clear-readiness decision

Required scope:
1. Inventory the sequence:
   - main objective
   - frameworks, commands, prompt packs, workflows, and overarching system flows involved
   - changed files
   - artifacts created
   - cross-workflow dependencies or handoffs used
   - system-level orchestration or control-plane boundaries affected
   - remaining follow-up work
2. Produce a debrief packet that clearly states:
   - what was attempted
   - what was completed
   - what evidence exists
   - how the participating frameworks/workflows/system flows fit together
   - where integration points were successful or fragile
   - what remains deferred
   - what the next tracked follow-up should be, if any
3. Decide whether a post-session learning artifact is required.
   - Required for substantial planning sessions, new prompt/system-rule authoring, major operator-UX friction, harness-truth mismatches, or any sequence that materially changed the system model.
   - If required, write a durable feedback artifact capturing:
     - what worked
     - what did not
     - what the user had to correct
     - what should become a system rule, prompt-pack rule, command-flow rule, or validation rule
4. Surface any action items revealed by the sequence that were NOT yet codified into prompt packs, commands, guardrails, workflow assets, or tests.
   - If none exist, say so explicitly.
   - If they do exist, list them as bounded action items with the target surface they belong in.
5. Run code validation appropriate to the changed surfaces.
   - If code or instruction-generation surfaces changed, run the relevant automated validation.
   - If only prompt/docs/planning files changed, run the lightest truthful checks that prove those surfaces are coherent.
   - If multiple frameworks, workflows, or system flows interacted, include at least one validation step that checks the integration seam, not only the individual parts in isolation.
   - Do not skip validation silently.
6. Decide whether the sequence is ready for clear.
   - `ready_for_clear` may be true only if:
     - the debrief packet exists
     - the required learning/reflection artifact exists when applicable
     - validation was run or its non-applicability is explicitly justified
     - no hidden required operator action remains
   - If any of those fail, do not recommend `clear`; report what is still pending.

Code-validation requirement:
- There must be a real validation step.
- Choose validation based on what changed.
- Examples:
  - multi-framework, multi-workflow, or system-flow implementation:
    - run targeted validation for each touched surface
    - run at least one seam/integration validation that proves the larger sequence works together truthfully
  - overarching system-flow changes:
    - validate the control surface, handoff logic, or status/reporting behavior affected by the sequence
    - verify the system-level flow is truthful about what is automated, what is manual, and what remains gated
  - instruction/canonical/command surface changes:
    - `npm run manifest:sync` when needed
    - `npm run instructions:validate`
    - `node --test tests/instructions/*.test.js` or the narrow relevant subset
  - tooling/code changes:
    - run the relevant targeted tests or validators for the touched code
  - prompt-system/planning-only changes:
    - parse `_dev/prompts/manifest.json` if touched
    - validate referenced files exist
    - run any narrow structural checks that keep prompt-system surfaces truthful
- Final output must state exactly what validation ran and why that level was appropriate.

Debrief packet requirements:
- The debrief packet must be a durable artifact, not only final-response prose.
- It must include:
  - sequence name or scope
  - participating frameworks/workflows/system flows
  - primary outcome
  - changed files
  - validation run
  - integration-seam validation
  - artifacts created
  - deferred items
  - recommended next tracked action

Clear-readiness signaling requirements:
- The clear-readiness decision must come after the debrief packet and after any required learning artifact.
- If the sequence is ready, end with:
  - `ready_for_clear: true`
  - `recommended_next_command: clear`
- If the sequence is not ready, end with:
  - `ready_for_clear: false`
  - `pending_items: [...]`
- Do not emit `recommended_next_command: clear` before the debrief and validation work is done.

Constraints:
- do not treat conversational memory as a substitute for a debrief artifact
- do not mark a sequence ready for clear if meaningful follow-up routing is still ambiguous
- do not skip learning capture when the session revealed reusable system lessons
- do not overstate validation; say exactly what was and was not checked
- do not treat successful validation of isolated components as sufficient when the work depended on the interaction between them
- do not recommend `clear` if uncodified action items are still ambiguous or hidden
- do not omit the lessons summary even when no new lessons were warranted; say that explicitly

At the end, provide:
- debrief artifact path
- learning/reflection artifact path or explicit reason it was not needed
- lessons summary
- uncodified action items or explicit statement that none remain
- validations run
- `ready_for_clear` status
- `recommended_next_command`
- any pending items that block `clear`
```
