---
name: ad-creative
description: >
  Generate, iterate, and scale ad creative — headlines, descriptions, primary text, and full ad variations — across paid advertising platforms with structured testing plans
---

<skill>
<objective>
Generate, iterate, and scale ad creative — headlines, descriptions, primary text, and full ad variations — across paid advertising platforms with structured testing plans
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Generate, iterate, and scale ad creative — headlines, descriptions, primary text, and full ad variations — across paid advertising platforms with structured testing plans

</what_this_skill_does>

<core_workflow>

1. Intake and Brand Context
2. Headline Generation
3. Full Ad Variations
4. Creative Testing Plan

</core_workflow>

<inputs>

- platform: Advertising platform to create ads for (e.g., Meta, Google Ads, LinkedIn)
- campaign_objective: Primary campaign objective (e.g., conversions, awareness, traffic)
- target_audience: Target audience demographics, interests, and behaviors
- product_description: Description of the product or service being advertised

</inputs>

<outputs>

- outputs/ad-creative/intake-and-brand-context.md
- outputs/ad-creative/headline-variations.md
- outputs/ad-creative/full-ad-variations.md
- outputs/ad-creative/creative-testing-plan.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_BRAND_CONTEXT.md" load="when_requested">Intake and Brand Context</ref>
  <ref path="prompts/02_HEADLINE_GENERATION.md" load="when_requested">Headline Generation</ref>
  <ref path="prompts/03_FULL_AD_VARIATIONS.md" load="when_requested">Full Ad Variations</ref>
  <ref path="prompts/04_CREATIVE_TESTING_PLAN.md" load="when_requested">Creative Testing Plan</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake and Brand Context</step>
    <step>Run Prompt 02: Headline Generation</step>
    <step>Run Prompt 03: Full Ad Variations</step>
    <step>Run Prompt 04: Creative Testing Plan</step>
  </workflow>
  <workflow name="status">
    <step>Check which output artifacts exist</step>
    <step>Report progress and next step</step>
  </workflow>
</workflows>

<success_criteria>
  <criterion>All prompt chain phases executed in order</criterion>
  <criterion>Output artifacts match output contract in manifest.json</criterion>
  <criterion>Guardrails.md constraints respected throughout execution</criterion>
  <criterion>No approximations — exact data and provenance required</criterion>
</success_criteria>
</skill>
