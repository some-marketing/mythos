---
name: dart-collaboration
description: >
  Abstract task creation and collaboration framework using Dart as human frontend and git workspace repos as LLM-consumable backend
---

<skill>
<objective>
Abstract task creation and collaboration framework using Dart as human frontend and git workspace repos as LLM-consumable backend
</objective>
<mcp_requirements>dart</mcp_requirements>

<execution_modes>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Abstract task creation and collaboration framework using Dart as human frontend and git workspace repos as LLM-consumable backend

</what_this_skill_does>

<core_workflow>

1. — Create Dart Task from Workspace Context
2. — Sync Task Index with Dart Board

</core_workflow>

<inputs>

- Dart MCP access: Connected Dart workspace with board access via MCP tools
- Workspace repo: Git repo following Mythos workspace pattern with tasks/index.json

</inputs>

<outputs>

- tasks/index.json
- Dart tasks via MCP

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_TASK_FROM_CONTEXT.md" load="when_requested">— Create Dart Task from Workspace Context</ref>
  <ref path="prompts/02_SYNC_INDEX.md" load="when_requested">— Sync Task Index with Dart Board</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Create Dart Task from Workspace Context</step>
    <step>Run Prompt 02: — Sync Task Index with Dart Board</step>
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
