---
name: livecanvas-rebuild
description: >
  Rebuild a bloated WordPress site (typically TheGem / WPBakery / Elementor / heavy multipurpose theme) into a lean LiveCanvas + Bootstrap stack while preserving all load-bearing commerce, content, and integration data. Built from the LMF Props ({CLIENT_CODE}.com) reference run.
---

<skill>
<objective>
Rebuild a bloated WordPress site (typically TheGem / WPBakery / Elementor / heavy multipurpose theme) into a lean LiveCanvas + Bootstrap stack while preserving all load-bearing commerce, content, and integration data. Built from the LMF Props ({CLIENT_CODE}.com) reference run.
</objective>
<mcp_requirements>playwright</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Rebuild a bloated WordPress site (typically TheGem / WPBakery / Elementor / heavy multipurpose theme) into a lean LiveCanvas + Bootstrap stack while preserving all load-bearing commerce, content, and integration data. Built from the LMF Props ({CLIENT_CODE}.com) reference run.

</what_this_skill_does>

<core_workflow>

1. Stage 1 — Audit
2. Stage 2 — Decision
3. Stage 3 — Local Rebuild
4. Stage 4 — Staging Promotion
5. Stage 5 — Cutover

</core_workflow>

<inputs>

- client.json: Mythos client registry record
- intake.json: Site URL, admin credentials reference (1Password item title), goals (preserve / sell / soft-relaunch / showcase / modernize), and constraints

</inputs>

<outputs>

- captures/homepage-recon.json
- captures/plugins-inventory.md
- captures/site-audit.jsonl
- captures/site-audit-summary.json
- captures/per-page-findings.md
- captures/probe-*.md
- outputs/current-site-analysis.md
- outputs/migration-readiness.md
- outputs/rebuild-plan.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_AUDIT.md" load="when_requested">Stage 1 — Audit</ref>
  <ref path="prompts/02_DECISION.md" load="when_requested">Stage 2 — Decision</ref>
  <ref path="prompts/03_LOCAL_REBUILD.md" load="when_requested">Stage 3 — Local Rebuild</ref>
  <ref path="prompts/04_STAGING_PROMOTION.md" load="when_requested">Stage 4 — Staging Promotion</ref>
  <ref path="prompts/05_CUTOVER.md" load="when_requested">Stage 5 — Cutover</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Stage 1 — Audit</step>
    <step>Run Prompt 02: Stage 2 — Decision</step>
    <step>Run Prompt 03: Stage 3 — Local Rebuild</step>
    <step>Run Prompt 04: Stage 4 — Staging Promotion</step>
    <step>Run Prompt 05: Stage 5 — Cutover</step>
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
