---
name: google-ads-search-campaign-build
description: >
  Build a new Google Ads Search campaign end-to-end: evidence intake, account structure, bidding and budget, keyword and match-type plan, RSA and assets, and measurement and launch — produced as a preview-approve-push bundle.
---

<skill>
<objective>
Build a new Google Ads Search campaign end-to-end: evidence intake, account structure, bidding and budget, keyword and match-type plan, RSA and assets, and measurement and launch — produced as a preview-approve-push bundle.
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
  <mode name="RUN_ONLY">run only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Build a new Google Ads Search campaign end-to-end: evidence intake, account structure, bidding and budget, keyword and match-type plan, RSA and assets, and measurement and launch — produced as a preview-approve-push bundle.

</what_this_skill_does>

<core_workflow>

1. — Intake and Evidence
2. — Account Structure Design
3. — Bidding and Budget Plan
4. — Keywords and Match Types
5. — RSA and Assets
6. — Measurement and Launch

</core_workflow>

<inputs>

(See manifest.json for input contract)

</inputs>

<outputs>

(See manifest.json for output contract)

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_intake-and-evidence.md" load="when_requested">— Intake and Evidence</ref>
  <ref path="prompts/02_account-structure-design.md" load="when_requested">— Account Structure Design</ref>
  <ref path="prompts/03_bidding-and-budget-plan.md" load="when_requested">— Bidding and Budget Plan</ref>
  <ref path="prompts/04_keywords-and-match-types.md" load="when_requested">— Keywords and Match Types</ref>
  <ref path="prompts/05_rsa-and-assets.md" load="when_requested">— RSA and Assets</ref>
  <ref path="prompts/06_measurement-and-launch.md" load="when_requested">— Measurement and Launch</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Intake and Evidence</step>
    <step>Run Prompt 02: — Account Structure Design</step>
    <step>Run Prompt 03: — Bidding and Budget Plan</step>
    <step>Run Prompt 04: — Keywords and Match Types</step>
    <step>Run Prompt 05: — RSA and Assets</step>
    <step>Run Prompt 06: — Measurement and Launch</step>
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
