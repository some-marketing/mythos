---
name: content-editing
description: >
  Scoped WordPress admin content editing with authenticated navigation, bounded changes, visual and functional verification, and publish/freeze handoff reporting
---

<skill>
<objective>
Scoped WordPress admin content editing with authenticated navigation, bounded changes, visual and functional verification, and publish/freeze handoff reporting
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
  <mode name="COORDINATOR">coordinator</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Scoped WordPress admin content editing with authenticated navigation, bounded changes, visual and functional verification, and publish/freeze handoff reporting

</what_this_skill_does>

<core_workflow>

1. — Intake And Scope
2. — Admin Recon And Pre-Edit Capture
3. — Apply Bounded Edits
4. — Verify Editor And Frontend
5. — Review And Approval Gate
6. — Publish Or Freeze And Handoff

</core_workflow>

<inputs>

- site-config.json: Target WordPress site, credential reference, editor expectations, and environment safety rules
- edit-request.json: Target page/post identifiers, allowed change scope, field-level edit intent, and publish policy
- success-criteria.md: Human-readable acceptance criteria for the requested content changes

</inputs>

<outputs>

- capture-log.json
- edit-plan.json
- verification-report.json
- publish-report.json
- change-summary.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/00_INTAKE_AND_SCOPE.md" load="when_requested">— Intake And Scope</ref>
  <ref path="prompts/01_ADMIN_RECON_AND_PRE_EDIT_CAPTURE.md" load="when_requested">— Admin Recon And Pre-Edit Capture</ref>
  <ref path="prompts/02_APPLY_BOUNDED_EDITS.md" load="when_requested">— Apply Bounded Edits</ref>
  <ref path="prompts/03_VERIFY_EDITOR_AND_FRONTEND.md" load="when_requested">— Verify Editor And Frontend</ref>
  <ref path="prompts/04_REVIEW_AND_APPROVAL_GATE.md" load="when_requested">— Review And Approval Gate</ref>
  <ref path="prompts/05_PUBLISH_OR_FREEZE_AND_HANDOFF.md" load="when_requested">— Publish Or Freeze And Handoff</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Intake And Scope</step>
    <step>Run Prompt 02: — Admin Recon And Pre-Edit Capture</step>
    <step>Run Prompt 03: — Apply Bounded Edits</step>
    <step>Run Prompt 04: — Verify Editor And Frontend</step>
    <step>Run Prompt 05: — Review And Approval Gate</step>
    <step>Run Prompt 06: — Publish Or Freeze And Handoff</step>
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
