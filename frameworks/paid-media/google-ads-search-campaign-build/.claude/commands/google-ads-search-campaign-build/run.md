---
name: run
description: Run the full framework pipeline
skill: google-ads-search-campaign-build
mode: PATCH_ALLOWED

---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: — Intake and Evidence
4. Run Prompt 02: — Account Structure Design
5. Run Prompt 03: — Bidding and Budget Plan
6. Run Prompt 04: — Keywords and Match Types
7. Run Prompt 05: — RSA and Assets
8. Run Prompt 06: — Measurement and Launch
9. For each phase: execute the prompt, verify outputs, and record progression.
10. After the final phase: validate all output artifacts against the manifest's `output_contract`.
11. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
