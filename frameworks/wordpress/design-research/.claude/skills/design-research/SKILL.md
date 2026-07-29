---
name: design-research
description: >
  Pre-build design research, competitive site analysis, and design mockup creation for web development projects
---

<skill>
<objective>
Pre-build design research, competitive site analysis, and design mockup creation for web development projects
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Pre-build design research, competitive site analysis, and design mockup creation for web development projects

</what_this_skill_does>

<core_workflow>

1. Website Research Prompt — Input Guide
2. Website Design & Market Research Prompt
3. Farther-Afield Research & Bundled Variations Prompt

</core_workflow>

<inputs>

- intake.json: Client info, business details, design preferences, and target audience data

</inputs>

<outputs>

- completed_research_prompt.md
- FEATURE_MATRIX.md
- COMPETITIVE_SUMMARY.md
- mockup_brief.json
- DESIGN_SPEC.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_RESEARCH_PROMPT_INPUTS.md" load="when_requested">Website Research Prompt — Input Guide</ref>
  <ref path="prompts/02_RESEARCH_PROMPT.md" load="when_requested">Website Design & Market Research Prompt</ref>
  <ref path="prompts/03_FARTHER_AFIELD_AND_BUNDLED_VARIATIONS_PROMPT.md" load="when_requested">Farther-Afield Research & Bundled Variations Prompt</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Website Research Prompt — Input Guide</step>
    <step>Run Prompt 02: Website Design & Market Research Prompt</step>
    <step>Run Prompt 03: Farther-Afield Research & Bundled Variations Prompt</step>
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
