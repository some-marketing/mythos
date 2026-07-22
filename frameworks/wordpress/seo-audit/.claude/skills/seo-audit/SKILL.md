---
name: seo-audit
description: >
  Multi-phase SEO audit for WordPress sites: technical, on-page, content quality, and prioritized action plan
---

<skill>
<objective>
Multi-phase SEO audit for WordPress sites: technical, on-page, content quality, and prioritized action plan
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Multi-phase SEO audit for WordPress sites: technical, on-page, content quality, and prioritized action plan

</what_this_skill_does>

<core_workflow>

1. Intake and Scope
2. Technical SEO Audit
3. On-Page SEO Audit
4. Content Quality Assessment
5. Action Plan and Executive Summary

</core_workflow>

<inputs>

- site_url: URL of the WordPress site to audit
- site_type: Type of site (e.g., ecommerce, blog, SaaS, local business)
- seo_goals: Primary SEO objectives and target outcomes

</inputs>

<outputs>

- outputs/seo-audit/technical-findings.md
- outputs/seo-audit/on-page-findings.md
- outputs/seo-audit/content-findings.md
- outputs/seo-audit/action-plan.md
- outputs/seo-audit/executive-summary.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_SCOPE.md" load="when_requested">Intake and Scope</ref>
  <ref path="prompts/02_TECHNICAL_AUDIT.md" load="when_requested">Technical SEO Audit</ref>
  <ref path="prompts/03_ON_PAGE_AUDIT.md" load="when_requested">On-Page SEO Audit</ref>
  <ref path="prompts/04_CONTENT_QUALITY_AUDIT.md" load="when_requested">Content Quality Assessment</ref>
  <ref path="prompts/05_ACTION_PLAN_AND_SUMMARY.md" load="when_requested">Action Plan and Executive Summary</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake and Scope</step>
    <step>Run Prompt 02: Technical SEO Audit</step>
    <step>Run Prompt 03: On-Page SEO Audit</step>
    <step>Run Prompt 04: Content Quality Assessment</step>
    <step>Run Prompt 05: Action Plan and Executive Summary</step>
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
