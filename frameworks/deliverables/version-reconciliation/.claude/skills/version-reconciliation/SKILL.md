---
name: version-reconciliation
description: >
  Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison
---

<skill>
<objective>
Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison

</what_this_skill_does>

<core_workflow>

1. — Extract and Diff
2. — Report and Reconcile

</core_workflow>

<inputs>

- version_a: Path to first version (.md, .docx, .pptx, .pdf)
- version_b: Path to second version (may differ in format from version_a)

</inputs>

<outputs>

- CONTRADICTION_REPORT.md
- reconciliation_summary.json
- reconciliation_log.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_EXTRACT_AND_DIFF.md" load="when_requested">— Extract and Diff</ref>
  <ref path="prompts/02_REPORT_AND_RECONCILE.md" load="when_requested">— Report and Reconcile</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Extract and Diff</step>
    <step>Run Prompt 02: — Report and Reconcile</step>
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
