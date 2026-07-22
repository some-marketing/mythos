---
name: run
description: Run the full framework pipeline
skill: page-cro
mode: PATCH_ALLOWED
arguments:
  - name: page_urls
    description: URLs of the pages to audit for conversion optimization
    required: true
  - name: conversion_goals
    description: Primary conversion goals for the pages (e.g., form submissions, purchases, signups)
    required: true
  - name: page_type
    description: Type of page being audited (e.g., landing page, product page, pricing page)
    required: true
  - name: traffic_sources
    description: Primary traffic sources driving visitors to the pages
    required: false
  - name: current_conversion_rate
    description: Current conversion rate baseline for benchmarking
    required: false
  - name: target_conversion_rate
    description: Target conversion rate to achieve
    required: false
  - name: heatmap_data
    description: Heatmap or click-tracking data for user behavior analysis
    required: false
  - name: session_recordings
    description: Session recording tool access for user journey analysis
    required: false
  - name: existing_ab_tests
    description: Currently running or past A/B test results
    required: false
  - name: analytics_access
    description: Analytics platform access details for data-driven recommendations
    required: false
  - name: competitor_urls
    description: Competitor page URLs for comparative analysis
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake and Scope
4. Run Prompt 02: Conversion Analysis
5. Run Prompt 03: Recommendations
6. Run Prompt 04: Experiment Design
7. For each phase: execute the prompt, verify outputs, and record progression.
8. After the final phase: validate all output artifacts against the manifest's `output_contract`.
9. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
