---
name: run
description: Run the full framework pipeline
skill: design-research
mode: PATCH_ALLOWED
arguments:
  - name: intake.json
    description: Client info, business details, design preferences, and target audience data
    required: true
  - name: sites.json
    description: Array of site definitions for competitive audit (slug, name, url, inventory_path)
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Website Research Prompt — Input Guide
4. Run Prompt 02: Website Design & Market Research Prompt
5. Run Prompt 03: Farther-Afield Research & Bundled Variations Prompt
6. For each phase: execute the prompt, verify outputs, and record progression.
7. After the final phase: validate all output artifacts against the manifest's `output_contract`.
8. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
