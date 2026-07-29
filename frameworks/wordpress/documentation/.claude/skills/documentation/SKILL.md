---
name: documentation
description: >
  Client-facing WordPress admin documentation via MCP browser walkthroughs with Notion output
---

<skill>
<objective>
Client-facing WordPress admin documentation via MCP browser walkthroughs with Notion output
</objective>
<mcp_requirements>playwright, notion</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Client-facing WordPress admin documentation via MCP browser walkthroughs with Notion output

</what_this_skill_does>

<core_workflow>

1. Prompt — Intake (What documentation should we produce?)
2. Prompt — MCP Walkthrough Capture (Write Step Log + Screenshot List)
3. Prompt — Draft User Guide from Step Log
4. Prompt — Verify Guide via MCP (Doc Drift Check)

</core_workflow>

<inputs>

- config.json: Client config with WordPress URL, credentials reference, Notion page IDs
- guides.json: Guide definitions with steps, screenshots, and safety rules

</inputs>

<outputs>

- step_log.json
- drift_report.md
- guide content in Notion

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/00_INTAKE.md" load="when_requested">Prompt — Intake (What documentation should we produce?)</ref>
  <ref path="prompts/01_MCP_WALKTHROUGH_CAPTURE.md" load="when_requested">Prompt — MCP Walkthrough Capture (Write Step Log + Screenshot List)</ref>
  <ref path="prompts/02_DRAFT_GUIDE_FROM_STEP_LOG.md" load="when_requested">Prompt — Draft User Guide from Step Log</ref>
  <ref path="prompts/03_VERIFY_GUIDE_VIA_MCP.md" load="when_requested">Prompt — Verify Guide via MCP (Doc Drift Check)</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Prompt — Intake (What documentation should we produce?)</step>
    <step>Run Prompt 02: Prompt — MCP Walkthrough Capture (Write Step Log + Screenshot List)</step>
    <step>Run Prompt 03: Prompt — Draft User Guide from Step Log</step>
    <step>Run Prompt 04: Prompt — Verify Guide via MCP (Doc Drift Check)</step>
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
