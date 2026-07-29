---
name: feedback-to-tasks
description: >
  Compiles stakeholder feedback from PM tools into provenance-cited task lists for developers without tool access
---

<skill>
<objective>
Compiles stakeholder feedback from PM tools into provenance-cited task lists for developers without tool access
</objective>
<mcp_requirements>dart, notion</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Compiles stakeholder feedback from PM tools into provenance-cited task lists for developers without tool access

</what_this_skill_does>

<core_workflow>

1. — Communication Architecture
2. — Source Fetch
3. — Provenance Audit
4. — Ambiguity Flagging
5. — Task Formatting

</core_workflow>

<inputs>

- source_tool: PM tool containing feedback: 'dart' or 'notion'
- source_location: Board name, page URL, or database ID in the source tool
- destination_format: Output format: 'markdown', 'json', or 'github-issues'

</inputs>

<outputs>

- TASK_LIST.md
- task_compilation_summary.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_COMMUNICATION_ARCHITECTURE.md" load="when_requested">— Communication Architecture</ref>
  <ref path="prompts/02_SOURCE_FETCH.md" load="when_requested">— Source Fetch</ref>
  <ref path="prompts/03_PROVENANCE_AUDIT.md" load="when_requested">— Provenance Audit</ref>
  <ref path="prompts/04_AMBIGUITY_FLAGGING.md" load="when_requested">— Ambiguity Flagging</ref>
  <ref path="prompts/05_TASK_FORMATTING.md" load="when_requested">— Task Formatting</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Communication Architecture</step>
    <step>Run Prompt 02: — Source Fetch</step>
    <step>Run Prompt 03: — Provenance Audit</step>
    <step>Run Prompt 04: — Ambiguity Flagging</step>
    <step>Run Prompt 05: — Task Formatting</step>
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
