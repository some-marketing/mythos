---
name: run
description: Run the full framework pipeline
skill: content-editing
mode: PATCH_ALLOWED
arguments:
  - name: site-config.json
    description: Target WordPress site, credential reference, editor expectations, and environment safety rules
    required: true
  - name: edit-request.json
    description: Target page/post identifiers, allowed change scope, field-level edit intent, and publish policy
    required: true
  - name: success-criteria.md
    description: Human-readable acceptance criteria for the requested content changes
    required: true
  - name: selector-hints.json
    description: Known editor selectors or field mappings for custom page builders
    required: false
  - name: reference-artifacts/
    description: Supporting copy decks, screenshots, structured payloads, prior page captures, or source-of-truth visual references
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: — Intake And Scope
4. Run Prompt 02: — Admin Recon And Pre-Edit Capture
5. Run Prompt 03: — Apply Bounded Edits
6. Run Prompt 04: — Verify Editor And Frontend
7. Run Prompt 05: — Review And Approval Gate
8. Run Prompt 06: — Publish Or Freeze And Handoff
9. For each phase: execute the prompt, verify outputs, and record progression.
10. After the final phase: validate all output artifacts against the manifest's `output_contract`.
11. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
