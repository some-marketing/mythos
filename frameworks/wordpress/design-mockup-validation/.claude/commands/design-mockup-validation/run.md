---
name: run
description: Run the full framework pipeline
skill: design-mockup-validation
mode: PATCH_ALLOWED
arguments:
  - name: intake.json
    description: Normalized task inputs for a new execution
    required: true
  - name: context.md
    description: Non-secret context for the task run
    required: true
  - name: reference_artifacts/
    description: Optional supporting artifacts referenced during execution
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake From Capture
4. Run Prompt 02: Execute Stable Workflow
5. Run Prompt 03: Review And Compare
6. For each phase: execute the prompt, verify outputs, and record progression.
7. After the final phase: validate all output artifacts against the manifest's `output_contract`.
8. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
