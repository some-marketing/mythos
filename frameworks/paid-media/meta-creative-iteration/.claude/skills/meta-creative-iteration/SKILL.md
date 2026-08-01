---
name: meta-creative-iteration
description: >
  Algorithm-aware Meta ad creative iteration framework. 9 stage prompts from conversion-signal sanity through framework-class insight readout. Internalizes Meta's 2024-2025 platform shifts (GEM, Andromeda, Sequence Learning) per the hardened concept at _dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md. Composes with tools/mcp/meta-ads/ (compliance + write surface), tools/mcp/delesign/ (brief surface, with Chrome-MCP fallback while vendor 500 blocks API submit), and the Big Book of Static Ad Frameworks parsed at tools/notion/parse-ad-frameworks.js. Meta-only in v1.
---

<skill>
<objective>
Algorithm-aware Meta ad creative iteration framework. 9 stage prompts from conversion-signal sanity through framework-class insight readout. Internalizes Meta's 2024-2025 platform shifts (GEM, Andromeda, Sequence Learning) per the hardened concept at _dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md. Composes with tools/mcp/meta-ads/ (compliance + write surface), tools/mcp/delesign/ (brief surface, with Chrome-MCP fallback while vendor 500 blocks API submit), and the Big Book of Static Ad Frameworks parsed at tools/notion/parse-ad-frameworks.js. Meta-only in v1.
</objective>
<mcp_requirements>meta-ads, delesign, claude-in-chrome</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Algorithm-aware Meta ad creative iteration framework. 9 stage prompts from conversion-signal sanity through framework-class insight readout. Internalizes Meta's 2024-2025 platform shifts (GEM, Andromeda, Sequence Learning) per the hardened concept at _dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md. Composes with tools/mcp/meta-ads/ (compliance + write surface), tools/mcp/delesign/ (brief surface, with Chrome-MCP fallback while vendor 500 blocks API submit), and the Big Book of Static Ad Frameworks parsed at tools/notion/parse-ad-frameworks.js. Meta-only in v1.

</what_this_skill_does>

<core_workflow>

1. Stage 0 — Conversion-Signal Sanity Check
2. Stage 1 — Message Hypothesis + Falsification + Landing-Page Congruence
3. Stage 2 — Framework Mix Selection + Model-Visible Diversity Audit
4. Stage 3 — Mockup Generation (Reference-Only)
5. Stage 4 — Delesign Brief + Bundle Submission
6. Stage 5a — Pre-Registration
7. Stage 5 — Push to Meta, Tagged by Framework
8. Stage 6 — Insights Readout (with `do_not_decide_yet` Gate)
9. Stage 7 — Refresh Trigger Evaluation

</core_workflow>

<inputs>

- client_project_path: Path to the target clients/<CLIENT>/projects/meta-app-integration/project.json. The framework reads ad_account_id and compliance_posture from that file. The framework knows nothing client-specific by itself.
- campaign_goal: Business goal driving this iteration cycle (e.g., drive financing applications, increase service-bay bookings).

</inputs>

<outputs>

- outputs/meta-creative-iteration/00-conversion-signal-sanity.json
- outputs/meta-creative-iteration/01-message-hypothesis.json
- outputs/meta-creative-iteration/02-framework-mix.json
- outputs/meta-creative-iteration/03-mockups/
- outputs/meta-creative-iteration/04-delesign-briefs.json
- outputs/meta-creative-iteration/05-meta-push-payloads.json
- outputs/meta-creative-iteration/05a-preregistration.json
- outputs/meta-creative-iteration/06-readout.json
- outputs/meta-creative-iteration/06-readout-narrative.json
- outputs/meta-creative-iteration/07-refresh-decisions.json
- outputs/meta-creative-iteration/iteration-bundle.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/00_CONVERSION_SIGNAL_SANITY.md" load="when_requested">Stage 0 — Conversion-Signal Sanity Check</ref>
  <ref path="prompts/01_MESSAGE_HYPOTHESIS.md" load="when_requested">Stage 1 — Message Hypothesis + Falsification + Landing-Page Congruence</ref>
  <ref path="prompts/02_FRAMEWORK_MIX_AND_DIVERSITY_AUDIT.md" load="when_requested">Stage 2 — Framework Mix Selection + Model-Visible Diversity Audit</ref>
  <ref path="prompts/03_MOCKUP_GENERATION.md" load="when_requested">Stage 3 — Mockup Generation (Reference-Only)</ref>
  <ref path="prompts/04_DELESIGN_BRIEF_AND_BUNDLE.md" load="when_requested">Stage 4 — Delesign Brief + Bundle Submission</ref>
  <ref path="prompts/05A_PREREGISTRATION.md" load="when_requested">Stage 5a — Pre-Registration</ref>
  <ref path="prompts/05_META_PUSH_TAGGED_BY_FRAMEWORK.md" load="when_requested">Stage 5 — Push to Meta, Tagged by Framework</ref>
  <ref path="prompts/06_INSIGHTS_READOUT.md" load="when_requested">Stage 6 — Insights Readout (with `do_not_decide_yet` Gate)</ref>
  <ref path="prompts/07_REFRESH_TRIGGER_EVALUATION.md" load="when_requested">Stage 7 — Refresh Trigger Evaluation</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: Stage 0 — Conversion-Signal Sanity Check</step>
    <step>Run Prompt 02: Stage 1 — Message Hypothesis + Falsification + Landing-Page Congruence</step>
    <step>Run Prompt 03: Stage 2 — Framework Mix Selection + Model-Visible Diversity Audit</step>
    <step>Run Prompt 04: Stage 3 — Mockup Generation (Reference-Only)</step>
    <step>Run Prompt 05: Stage 4 — Delesign Brief + Bundle Submission</step>
    <step>Run Prompt 06: Stage 5a — Pre-Registration</step>
    <step>Run Prompt 07: Stage 5 — Push to Meta, Tagged by Framework</step>
    <step>Run Prompt 08: Stage 6 — Insights Readout (with `do_not_decide_yet` Gate)</step>
    <step>Run Prompt 09: Stage 7 — Refresh Trigger Evaluation</step>
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
