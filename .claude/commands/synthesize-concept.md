---
description: Synthesize all model responses into a unified concept position
mode: PATCH_ALLOWED
---

<objective>
Merge all model responses for a concept bundle into a synthesis document, update the canonical concept.md if the synthesis changes the core decision, and mark the concept as synthesized.
</objective>

<process>
- Parse arguments for concept slug.
- Read all inputs: _dev/concepts/<slug>/concept.md (canonical), _dev/concepts/<slug>/status.json, all files in _dev/concepts/<slug>/dispatch/ matching *-response.md, and any material in _dev/concepts/<slug>/context/.
- Verify readiness: all dispatches in status.json should have status reviewed or merged. If any dispatch is still awaiting_response, warn and ask whether to proceed with partial synthesis.
- Build synthesis: write _dev/concepts/<slug>/synthesis.md with sections for Consensus, Strongest Contributions (attributed by model), Contradictions Resolved (with reasoning), Updated Position, Changes to Canonical Concept, and Remaining Open Questions.
- Update concept.md if needed: if the synthesis changes the core decision, rationale, or scope, update concept.md with a note referencing the synthesis date and contributing models. If no changes needed, leave as-is.
- Update status.json: set stage to synthesized.
- Report: summary of what changed, whether concept.md was updated, and recommended next step (promote, park, or dispatch to another model).
</process>

<success_criteria>
- synthesis.md written with all sections populated
- Contradictions explicitly resolved with reasoning
- concept.md updated only if synthesis warrants it
- status.json stage set to synthesized
- Clear next-step recommendation
</success_criteria>

<handoff>
ready_to_promote: /concept-promote <slug> --to-framework|skill|policy
needs_more_input: /concept-dispatch <slug> --model <target>
park: No action needed, concept is stable
</handoff>
