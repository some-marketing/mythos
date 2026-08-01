---
name: run
description: Run the full framework pipeline
skill: ad-creative
mode: PATCH_ALLOWED
arguments:
  - name: platform
    description: Advertising platform to create ads for (e.g., Meta, Google Ads, LinkedIn)
    required: true
  - name: campaign_objective
    description: Primary campaign objective (e.g., conversions, awareness, traffic)
    required: true
  - name: target_audience
    description: Target audience demographics, interests, and behaviors
    required: true
  - name: product_description
    description: Description of the product or service being advertised
    required: true
  - name: brand_voice
    description: Brand voice and tone guidelines for ad copy
    required: false
  - name: existing_ads
    description: Current ad creative for reference and iteration
    required: false
  - name: landing_page_urls
    description: Landing page URLs the ads will drive traffic to
    required: false
  - name: competitor_ads
    description: Competitor ad examples for differentiation analysis
    required: false
  - name: character_limits
    description: Platform-specific character limits for ad fields
    required: false
  - name: visual_guidelines
    description: Visual brand guidelines and image requirements
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: Intake and Brand Context
4. Run Prompt 02: Headline Generation
5. Run Prompt 03: Full Ad Variations
6. Run Prompt 04: Creative Testing Plan
7. For each phase: execute the prompt, verify outputs, and record progression.
8. After the final phase: validate all output artifacts against the manifest's `output_contract`.
9. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
