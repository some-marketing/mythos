---
description: Run the full framework pipeline
mode: PATCH_ALLOWED
---

<objective>
Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.
</objective>

<process>
- Load `guardrails.md` for execution constraints.
- Identify the project context and output directory.
- Iterate through the `prompt_chain` defined in `manifest.json`.
- For each phase: execute the prompt, verify outputs, and record progression.
- After the final phase: validate all output artifacts against the manifest's `output_contract`.
- Run `/debrief-run` to capture session learnings and artifacts.
</process>

<success_criteria>
- All prompt chain phases executed in order
- Output artifacts match manifest output contract
- Guardrails.md constraints respected throughout execution
- Debrief artifacts generated and validated
</success_criteria>
