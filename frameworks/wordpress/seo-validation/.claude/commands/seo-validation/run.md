---
name: run
description: Run the full framework pipeline
skill: seo-validation
mode: PATCH_ALLOWED
arguments:
  - name: site-config.json
    description: Target site URL, optional auth credentials reference, crawl scope rules (include/exclude patterns), and page-type classification hints
    required: true
  - name: check-config.json
    description: Which checks to run, pass/fail thresholds, mobile devices to emulate. Defaults to all checks with standard thresholds.
    required: false
  - name: known-issues.json
    description: Known issues to suppress from the findings report (e.g., expected missing alt text on decorative images)
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: — Intake and Site Discovery
4. Run Prompt 02: Prompt 02 -- Crawl and Extract SEO Signals
5. Run Prompt 03: Prompt 03 — Validate SEO Checks
6. Run Prompt 04: Prompt 04 -- Mobile Rendering and Performance
7. Run Prompt 05: Prompt 05 -- Findings Report
8. Run Prompt 06: — Dev Handoff
9. For each phase: execute the prompt, verify outputs, and record progression.
10. After the final phase: validate all output artifacts against the manifest's `output_contract`.
11. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
