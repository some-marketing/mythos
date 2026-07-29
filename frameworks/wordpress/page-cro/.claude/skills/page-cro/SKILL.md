---
name: page-cro
description: >
  Multi-phase conversion rate optimization audit for marketing pages: value proposition, CTA analysis, trust signals, friction assessment, and A/B experiment design
---

<skill>
<objective>
Multi-phase conversion rate optimization audit for marketing pages: value proposition, CTA analysis, trust signals, friction assessment, and A/B experiment design
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Multi-phase conversion rate optimization audit for marketing pages: value proposition, CTA analysis, trust signals, friction assessment, and A/B experiment design

</what_this_skill_does>

<core_workflow>

1. Intake and Scope
2. Conversion Analysis
3. Recommendations
4. Experiment Design

</core_workflow>

<inputs>

- page_urls: URLs of the pages to audit for conversion optimization
- conversion_goals: Primary conversion goals for the pages (e.g., form submissions, purchases, signups)
- page_type: Type of page being audited (e.g., landing page, product page, pricing page)

</inputs>

<outputs>

- outputs/page-cro/intake-summary.md
- outputs/page-cro/conversion-analysis.md
- outputs/page-cro/recommendations.md
- outputs/page-cro/experiment-design.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_SCOPE.md" load="when_requested">Intake and Scope</ref>
  <ref path="prompts/02_CONVERSION_ANALYSIS.md" load="when_requested">Conversion Analysis</ref>
  <ref path="prompts/03_RECOMMENDATIONS.md" load="when_requested">Recommendations</ref>
  <ref path="prompts/04_EXPERIMENT_DESIGN.md" load="when_requested">Experiment Design</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake and Scope</step>
    <step>Run Prompt 02: Conversion Analysis</step>
    <step>Run Prompt 03: Recommendations</step>
    <step>Run Prompt 04: Experiment Design</step>
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
