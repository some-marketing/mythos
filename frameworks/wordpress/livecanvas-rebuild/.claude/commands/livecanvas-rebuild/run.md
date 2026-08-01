---
name: run
description: Run the full framework pipeline
skill: livecanvas-rebuild
mode: PATCH_ALLOWED
arguments:
  - name: client.json
    description: Mythos client registry record
    required: true
  - name: intake.json
    description: Site URL, admin credentials reference (1Password item title), goals (preserve / sell / soft-relaunch / showcase / modernize), and constraints
    required: true
  - name: 1password_item
    description: 1P item title resolving to wp-admin user/pass; never inlined
    required: false
  - name: host_caching_notes.md
    description: Operator notes from host (e.g., 1-Click Web Apps) on server-level caching
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Stage 1 — Audit
4. Run Prompt 02: Stage 2 — Decision
5. Run Prompt 03: Stage 3 — Local Rebuild
6. Run Prompt 04: Stage 4 — Staging Promotion
7. Run Prompt 05: Stage 5 — Cutover
8. For each phase: execute the prompt, verify outputs, and record progression.
9. After the final phase: validate all output artifacts against the manifest's `output_contract`.
10. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
