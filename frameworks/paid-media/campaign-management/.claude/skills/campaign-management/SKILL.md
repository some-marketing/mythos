---
name: campaign-management
description: >
  End-to-end paid advertising campaign management: intake and account audit, campaign structure design, ad copy and creative briefs, and launch plan with measurement framework
---

<skill>
<objective>
End-to-end paid advertising campaign management: intake and account audit, campaign structure design, ad copy and creative briefs, and launch plan with measurement framework
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

End-to-end paid advertising campaign management: intake and account audit, campaign structure design, ad copy and creative briefs, and launch plan with measurement framework

</what_this_skill_does>

<core_workflow>

1. Intake and Audit
2. Campaign Structure
3. Ad Copy and Creative Brief
4. Launch Plan and Measurement

</core_workflow>

<inputs>

- platform: Advertising platform for the campaign (e.g., Meta, Google Ads, LinkedIn)
- budget: Campaign budget amount and period (e.g., daily, monthly, lifetime)
- target_audience: Target audience demographics, interests, and behaviors
- campaign_objective: Primary campaign objective (e.g., conversions, awareness, lead generation)

</inputs>

<outputs>

- outputs/campaign-management/intake-and-audit.md
- outputs/campaign-management/campaign-structure.md
- outputs/campaign-management/ad-copy-and-creative-brief.md
- outputs/campaign-management/launch-plan-and-measurement.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_AUDIT.md" load="when_requested">Intake and Audit</ref>
  <ref path="prompts/02_CAMPAIGN_STRUCTURE.md" load="when_requested">Campaign Structure</ref>
  <ref path="prompts/03_AD_COPY_AND_CREATIVE_BRIEF.md" load="when_requested">Ad Copy and Creative Brief</ref>
  <ref path="prompts/04_LAUNCH_PLAN_AND_MEASUREMENT.md" load="when_requested">Launch Plan and Measurement</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake and Audit</step>
    <step>Run Prompt 02: Campaign Structure</step>
    <step>Run Prompt 03: Ad Copy and Creative Brief</step>
    <step>Run Prompt 04: Launch Plan and Measurement</step>
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
