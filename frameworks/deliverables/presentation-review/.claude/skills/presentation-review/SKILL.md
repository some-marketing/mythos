---
name: presentation-review
description: >
  Cross-reference audit of client presentations against project plan documents, screenshots, and errata
---

<skill>
<objective>
Cross-reference audit of client presentations against project plan documents, screenshots, and errata
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Cross-reference audit of client presentations against project plan documents, screenshots, and errata

</what_this_skill_does>

<core_workflow>

1. — Intake and Discovery
2. — Presentation Extraction
3. — Source Document Index
4. — Slide Content Audit
5. — Screenshot Manifest Audit
6. — Corrections and Errata Check
7. — Gap Analysis and Synthesis
8. — Audit Report Assembly

</core_workflow>

<inputs>

- presentation_file: Path to .pptx presentation file to audit
- project_directory: Path to directory containing source documents, screenshots, and supporting files

</inputs>

<outputs>

- AUDIT_REPORT.md
- audit_summary.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_DISCOVERY.md" load="when_requested">— Intake and Discovery</ref>
  <ref path="prompts/02_PRESENTATION_EXTRACTION.md" load="when_requested">— Presentation Extraction</ref>
  <ref path="prompts/03_SOURCE_DOCUMENT_INDEX.md" load="when_requested">— Source Document Index</ref>
  <ref path="prompts/04_SLIDE_CONTENT_AUDIT.md" load="when_requested">— Slide Content Audit</ref>
  <ref path="prompts/05_SCREENSHOT_MANIFEST_AUDIT.md" load="when_requested">— Screenshot Manifest Audit</ref>
  <ref path="prompts/06_CORRECTIONS_AND_ERRATA_CHECK.md" load="when_requested">— Corrections and Errata Check</ref>
  <ref path="prompts/07_GAP_ANALYSIS_AND_SYNTHESIS.md" load="when_requested">— Gap Analysis and Synthesis</ref>
  <ref path="prompts/08_AUDIT_REPORT_ASSEMBLY.md" load="when_requested">— Audit Report Assembly</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Intake and Discovery</step>
    <step>Run Prompt 02: — Presentation Extraction</step>
    <step>Run Prompt 03: — Source Document Index</step>
    <step>Run Prompt 04: — Slide Content Audit</step>
    <step>Run Prompt 05: — Screenshot Manifest Audit</step>
    <step>Run Prompt 06: — Corrections and Errata Check</step>
    <step>Run Prompt 07: — Gap Analysis and Synthesis</step>
    <step>Run Prompt 08: — Audit Report Assembly</step>
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
