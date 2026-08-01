---
name: run
description: Run the full framework pipeline
skill: campaign-management
mode: PATCH_ALLOWED
arguments:
  - name: platform
    description: Advertising platform for the campaign (e.g., Meta, Google Ads, LinkedIn)
    required: true
  - name: budget
    description: Campaign budget amount and period (e.g., daily, monthly, lifetime)
    required: true
  - name: target_audience
    description: Target audience demographics, interests, and behaviors
    required: true
  - name: campaign_objective
    description: Primary campaign objective (e.g., conversions, awareness, lead generation)
    required: true
  - name: existing_account
    description: Existing ad account details for audit and migration
    required: false
  - name: competitor_urls
    description: Competitor URLs for competitive landscape analysis
    required: false
  - name: landing_page_urls
    description: Landing page URLs the campaigns will drive traffic to
    required: false
  - name: historical_performance
    description: Historical campaign performance data for benchmarking
    required: false
  - name: industry
    description: Industry vertical for benchmark comparisons and best practices
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake and Audit
4. Run Prompt 02: Campaign Structure
5. Run Prompt 03: Ad Copy and Creative Brief
6. Run Prompt 04: Launch Plan and Measurement
7. For each phase: execute the prompt, verify outputs, and record progression.
8. After the final phase: validate all output artifacts against the manifest's `output_contract`.
9. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
