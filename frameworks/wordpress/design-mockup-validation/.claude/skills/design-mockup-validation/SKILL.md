---
name: design-mockup-validation
description: >
  Cross-AI design mockup validation: evidence scrape, design token extraction, iterative Gemini mockup generation (3-attempt truth/variation/convergence cycle), Codex review gate, post-review fixes, and operator review packet assembly
---

<skill>
<objective>
Cross-AI design mockup validation: evidence scrape, design token extraction, iterative Gemini mockup generation (3-attempt truth/variation/convergence cycle), Codex review gate, post-review fixes, and operator review packet assembly
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Cross-AI design mockup validation: evidence scrape, design token extraction, iterative Gemini mockup generation (3-attempt truth/variation/convergence cycle), Codex review gate, post-review fixes, and operator review packet assembly

</what_this_skill_does>

<core_workflow>

1. Intake From Capture
2. Execute Stable Workflow
3. Review And Compare

</core_workflow>

<inputs>

- intake.json: Normalized task inputs for a new execution
- context.md: Non-secret context for the task run

</inputs>

<outputs>

- execution-summary.json
- review-report.json
- visual-validation.json
- FINAL_*.html

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_FROM_CAPTURE.md" load="when_requested">Intake From Capture</ref>
  <ref path="prompts/02_EXECUTE_STABLE_WORKFLOW.md" load="when_requested">Execute Stable Workflow</ref>
  <ref path="prompts/03_REVIEW_AND_COMPARE.md" load="when_requested">Review And Compare</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Intake From Capture</step>
    <step>Run Prompt 02: Execute Stable Workflow</step>
    <step>Run Prompt 03: Review And Compare</step>
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
