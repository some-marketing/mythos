---
name: seo-validation
description: >
  Playwright-based pre-launch SEO validation crawl for WordPress sites. Discovers pages via sitemap, renders in a real browser, extracts and validates SEO signals (H1, canonical, OG, alt text, structured data, links), checks mobile rendering with device emulation, and produces an observational findings report.
---

<skill>
<objective>
Playwright-based pre-launch SEO validation crawl for WordPress sites. Discovers pages via sitemap, renders in a real browser, extracts and validates SEO signals (H1, canonical, OG, alt text, structured data, links), checks mobile rendering with device emulation, and produces an observational findings report.
</objective>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Playwright-based pre-launch SEO validation crawl for WordPress sites. Discovers pages via sitemap, renders in a real browser, extracts and validates SEO signals (H1, canonical, OG, alt text, structured data, links), checks mobile rendering with device emulation, and produces an observational findings report.

</what_this_skill_does>

<core_workflow>

1. — Intake and Site Discovery
2. Prompt 02 -- Crawl and Extract SEO Signals
3. Prompt 03 — Validate SEO Checks
4. Prompt 04 -- Mobile Rendering and Performance
5. Prompt 05 -- Findings Report
6. — Dev Handoff

</core_workflow>

<inputs>

- site-config.json: Target site URL, optional auth credentials reference, crawl scope rules (include/exclude patterns), and page-type classification hints

</inputs>

<outputs>

- crawl/page-inventory.json
- crawl/extracted/
- crawl/crawl-summary.json
- crawl/errors.json
- checks/results.json
- mobile/results.json
- reports/findings.md
- reports/summary.json
- handoff/classification.json
- handoff/DEV_HANDOFF.md

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_SITE_DISCOVERY.md" load="when_requested">— Intake and Site Discovery</ref>
  <ref path="prompts/02_CRAWL_AND_EXTRACT.md" load="when_requested">Prompt 02 -- Crawl and Extract SEO Signals</ref>
  <ref path="prompts/03_VALIDATE_CHECKS.md" load="when_requested">Prompt 03 — Validate SEO Checks</ref>
  <ref path="prompts/04_MOBILE_AND_PERFORMANCE.md" load="when_requested">Prompt 04 -- Mobile Rendering and Performance</ref>
  <ref path="prompts/05_FINDINGS_REPORT.md" load="when_requested">Prompt 05 -- Findings Report</ref>
  <ref path="prompts/06_DEV_HANDOFF.md" load="when_requested">— Dev Handoff</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Intake and Site Discovery</step>
    <step>Run Prompt 02: Prompt 02 -- Crawl and Extract SEO Signals</step>
    <step>Run Prompt 03: Prompt 03 — Validate SEO Checks</step>
    <step>Run Prompt 04: Prompt 04 -- Mobile Rendering and Performance</step>
    <step>Run Prompt 05: Prompt 05 -- Findings Report</step>
    <step>Run Prompt 06: — Dev Handoff</step>
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
