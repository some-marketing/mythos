---
name: analytics-tracking
description: >
  Analytics implementation framework for WordPress sites: intake assessment, tracking plan development, GA4/GTM implementation, and validation
---

<skill>
<objective>
Analytics implementation framework for WordPress sites: intake assessment, tracking plan development, GA4/GTM implementation, and validation
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Analytics implementation framework for WordPress sites: intake assessment, tracking plan development, GA4/GTM implementation, and validation

</what_this_skill_does>

<core_workflow>

1. Intake and Assessment
2. Tracking Plan
3. Implementation
4. Validation

</core_workflow>

<inputs>

- site_url: URL of the target WordPress site
- site_type: Type of site (e.g., ecommerce, blog, SaaS)
- tracking_goals: Business tracking objectives and KPIs to measure

</inputs>

<outputs>

- outputs/analytics-tracking/intake-assessment.md
- outputs/analytics-tracking/tracking-plan.md
- outputs/analytics-tracking/implementation-spec.md
- outputs/analytics-tracking/validation-report.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_ASSESSMENT.md" load="when_requested">Intake and Assessment</ref>
  <ref path="prompts/02_TRACKING_PLAN.md" load="when_requested">Tracking Plan</ref>
  <ref path="prompts/03_IMPLEMENTATION.md" load="when_requested">Implementation</ref>
  <ref path="prompts/04_VALIDATION.md" load="when_requested">Validation</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake and Assessment</step>
    <step>Run Prompt 02: Tracking Plan</step>
    <step>Run Prompt 03: Implementation</step>
    <step>Run Prompt 04: Validation</step>
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
