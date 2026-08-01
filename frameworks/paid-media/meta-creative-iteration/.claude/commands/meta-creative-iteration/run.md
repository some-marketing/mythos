---
name: run
description: Run the full framework pipeline
skill: meta-creative-iteration
mode: PATCH_ALLOWED
arguments:
  - name: client_project_path
    description: Path to the target clients/<CLIENT>/projects/meta-app-integration/project.json. The framework reads ad_account_id and compliance_posture from that file. The framework knows nothing client-specific by itself.
    required: true
  - name: campaign_goal
    description: Business goal driving this iteration cycle (e.g., drive financing applications, increase service-bay bookings).
    required: true
  - name: prior_iteration_artifact
    description: Path to a prior iteration bundle for refresh-cycle continuity (winners, losers, lessons). Feeds Stage 1 and Stage 7.
    required: false
  - name: budget_window
    description: Daily/weekly/monthly budget the iteration is sized against. Influences Stage 5a sample-size minimums.
    required: false
  - name: delesign_mode_override
    description: Force 'api' or 'chrome-mcp-fallback' for Stage 4. Default is auto-detect based on Delesign API health.
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Stage 0 — Conversion-Signal Sanity Check
4. Run Prompt 02: Stage 1 — Message Hypothesis + Falsification + Landing-Page Congruence
5. Run Prompt 03: Stage 2 — Framework Mix Selection + Model-Visible Diversity Audit
6. Run Prompt 04: Stage 3 — Mockup Generation (Reference-Only)
7. Run Prompt 05: Stage 4 — Delesign Brief + Bundle Submission
8. Run Prompt 06: Stage 5a — Pre-Registration
9. Run Prompt 07: Stage 5 — Push to Meta, Tagged by Framework
10. Run Prompt 08: Stage 6 — Insights Readout (with `do_not_decide_yet` Gate)
11. Run Prompt 09: Stage 7 — Refresh Trigger Evaluation
12. For each phase: execute the prompt, verify outputs, and record progression.
13. After the final phase: validate all output artifacts against the manifest's `output_contract`.
14. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
