---
description: Convene a triadic Mythos profile on a task. Uses the invoking harness or slot as origin, fires scoped prompts to the other triad slots in parallel, collects responses, and writes artifacts so the origin slot can synthesize across all three voices.
mode: COORDINATOR
---

<objective>
Invoke tools/convene/convene.js with the correct origin and profile to fire a bounded task to the other slots of an Mythos triad in parallel. The default kernel profile preserves the historic Claude/Codex/Gemini roster; task-specific profiles may rotate actors by slot while preserving the three-corner structure. Collect responses to a dated artifact directory and synthesize across all three voices into one unified output.
</objective>

<process>
- 1. Parse the task from arguments. If empty, ask the operator what to convene on.
- 2. Identify relevant context files from the current session (task plans, briefs, synthesis docs, etc.) and include them as --context files.
- 3. Pick a short, kebab-case scope slug descriptive of the task.
- 4. Choose the triad profile. Default to --profile kernel unless the task is explicitly narrower, such as --profile code-review or --profile local-leaf. A narrower profile must not be presented as consequence-grade global consensus unless its manifest says consequence_grade: true.
- 5. Invoke tools/convene/convene.js via Bash with --origin <slot-or-harness-name>, --profile <profile-id>, --task, --scope, and --context flags. Use repeated --actor <slot=actor> only when the task shape requires a slot-specific substitution.
- 6. Wait for participant slots to return (Gemini ~30-60s, Codex ~60-180s; other adapters vary by harness).
- 7. Read the artifact directory printed by the script (prompts/ slot prompt files, slot__actor.md files, backward-compatible actor.md files when present, synthesis-skeleton.md, manifest.json).
- 8. Write the origin slot's analysis inline into synthesis-skeleton.md by replacing the origin placeholder with its own answer.
- 9. Synthesize across all three voices: fill in [SYNTHESIS SECTION] and [ONE-VOICE SUMMARY] placeholders. State disagreements, duplicate-actor degradations, non-consequence-grade profiles, and unresolved uncertainty explicitly.
- 10. Rename synthesis-skeleton.md to synthesis.md.
- 11. Present the unified synthesis to the operator.
</process>

<success_criteria>
- convene.js exited successfully with all participant slots returning 'success' or explicitly recorded blockers
- Artifact directory exists with all expected files
- Origin-slot analysis was written inline, not dropped
- Synthesis fills in cross-verification catches and net findings
- Output to operator is one unified voice, not three separate reports
- If the profile or actor overrides reduce distinct-intelligence coverage, the synthesis names that degradation rather than implying full consensus
</success_criteria>
