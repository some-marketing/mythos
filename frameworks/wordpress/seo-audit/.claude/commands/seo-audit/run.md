---
name: run
description: Run the full framework pipeline
skill: seo-audit
mode: PATCH_ALLOWED
arguments:
  - name: site_url
    description: URL of the WordPress site to audit
    required: true
  - name: site_type
    description: Type of site (e.g., ecommerce, blog, SaaS, local business)
    required: true
  - name: seo_goals
    description: Primary SEO objectives and target outcomes
    required: true
  - name: priority_keywords
    description: Target keywords or keyword clusters to focus the audit on
    required: false
  - name: search_console_access
    description: Google Search Console access details for performance data
    required: false
  - name: current_traffic_baseline
    description: Current organic traffic baseline for benchmarking
    required: false
  - name: recent_changes
    description: Recent site changes that may affect SEO (redesign, migration, content updates)
    required: false
  - name: competitor_urls
    description: Competitor URLs for comparative SEO analysis
    required: false
  - name: audit_scope
    description: Specific audit scope or focus areas (technical, on-page, content, or all)
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake and Scope
4. Run Prompt 02: Technical SEO Audit
5. Run Prompt 03: On-Page SEO Audit
6. Run Prompt 04: Content Quality Assessment
7. Run Prompt 05: Action Plan and Executive Summary
8. For each phase: execute the prompt, verify outputs, and record progression.
9. After the final phase: validate all output artifacts against the manifest's `output_contract`.
10. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
