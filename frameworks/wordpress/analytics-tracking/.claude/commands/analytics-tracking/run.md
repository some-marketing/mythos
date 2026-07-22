---
name: run
description: Run the full framework pipeline
skill: analytics-tracking
mode: PATCH_ALLOWED
arguments:
  - name: site_url
    description: URL of the target WordPress site
    required: true
  - name: site_type
    description: Type of site (e.g., ecommerce, blog, SaaS)
    required: true
  - name: tracking_goals
    description: Business tracking objectives and KPIs to measure
    required: true
  - name: ga4_measurement_id
    description: Existing GA4 measurement ID if already set up
    required: false
  - name: gtm_container_id
    description: Existing GTM container ID if already set up
    required: false
  - name: existing_tracking_tools
    description: Currently installed tracking tools and their state
    required: false
  - name: key_conversions
    description: Primary conversion events to track (form submissions, purchases, etc.)
    required: false
  - name: privacy_requirements
    description: Privacy/consent requirements (GDPR, CCPA, etc.)
    required: false
  - name: ecommerce_platform
    description: Ecommerce platform if applicable (WooCommerce, Shopify, etc.)
    required: false
  - name: consent_management_platform
    description: CMP in use for cookie/tracking consent
    required: false
  - name: utm_conventions
    description: UTM parameter naming conventions for campaign tracking
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake and Assessment
4. Run Prompt 02: Tracking Plan
5. Run Prompt 03: Implementation
6. Run Prompt 04: Validation
7. For each phase: execute the prompt, verify outputs, and record progression.
8. After the final phase: validate all output artifacts against the manifest's `output_contract`.
9. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
