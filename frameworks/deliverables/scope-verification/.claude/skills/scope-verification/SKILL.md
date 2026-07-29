---
name: scope-verification
description: >
  Verifies scope/proposal documents against source data by exact categorization, counting, and discrepancy detection
---

<skill>
<objective>
Verifies scope/proposal documents against source data by exact categorization, counting, and discrepancy detection
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Verifies scope/proposal documents against source data by exact categorization, counting, and discrepancy detection

</what_this_skill_does>

<core_workflow>

1. — Analyze
2. — Report and Update

</core_workflow>

<inputs>

- scope_document: Path to scope or proposal document (.md, .docx, .pdf)
- source_data: Path to source data (crawl directory, sitemap file, spreadsheet, or URL)

</inputs>

<outputs>

- DISCREPANCY_REPORT.md
- verification_summary.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_ANALYZE.md" load="when_requested">— Analyze</ref>
  <ref path="prompts/02_REPORT_AND_UPDATE.md" load="when_requested">— Report and Update</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Analyze</step>
    <step>Run Prompt 02: — Report and Update</step>
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
