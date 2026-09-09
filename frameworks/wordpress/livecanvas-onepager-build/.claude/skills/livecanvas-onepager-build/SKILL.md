---
name: livecanvas-onepager-build
description: >
  Build a new one-page marketing site for a local trades/service business on WordPress + Picostrap 5 + LiveCanvas: intake and research with brand facts pinned, a reviewed design spec (sourced copy, hex tokens, font-licence reality), design tokens applied through the Customizer API, page and header/footer partials injected through the LiveCanvas editor API with every save verified on the public URL, a phone-first check in the editor's device emulator, and a client design-direction review email drafted for the operator to send. Distilled from the first reference run (client code BRE), 2026-09-09.
---

<skill>
<objective>
Build a new one-page marketing site for a local trades/service business on WordPress + Picostrap 5 + LiveCanvas: intake and research with brand facts pinned, a reviewed design spec (sourced copy, hex tokens, font-licence reality), design tokens applied through the Customizer API, page and header/footer partials injected through the LiveCanvas editor API with every save verified on the public URL, a phone-first check in the editor's device emulator, and a client design-direction review email drafted for the operator to send. Distilled from the first reference run (client code BRE), 2026-09-09.
</objective>
<mcp_requirements>claude-in-chrome, gmail</mcp_requirements>

<execution_modes>
  <mode name="FINDINGS_ONLY">findings only</mode>
  <mode name="RUN_ONLY">run only</mode>
  <mode name="REVIEW_ONLY">review only</mode>
  <mode name="PATCH_ALLOWED">patch allowed</mode>
</execution_modes>

<quick_start>
<what_this_skill_does>

Build a new one-page marketing site for a local trades/service business on WordPress + Picostrap 5 + LiveCanvas: intake and research with brand facts pinned, a reviewed design spec (sourced copy, hex tokens, font-licence reality), design tokens applied through the Customizer API, page and header/footer partials injected through the LiveCanvas editor API with every save verified on the public URL, a phone-first check in the editor's device emulator, and a client design-direction review email drafted for the operator to send. Distilled from the first reference run (client code BRE), 2026-09-09.

</what_this_skill_does>

<core_workflow>

1. — Intake and Research
2. — Design Spec
3. — Theme Tokens (Picostrap Customizer)
4. — Page Build (LiveCanvas)
5. — Client Review

</core_workflow>

<inputs>

- client.json: SM_OS client registry record (brand block: wordmark font, colours, services list, live-site URL, demo-site URL)
- intake.json: Kickoff form answers: business description, service area, audience (B2C/B2B), top services in priority order, high-stakes trigger, top comparison factors, differentiator, elevator pitch, credentials, named competitors, inspiration sites, style preference, assets on hand, target search phrases
- context-bundle/: Kickoff-call transcript (verbatim), raw questionnaire answers, brand assets (card front/back, logo exports), all client-supplied photos with a hero-quality rating table, current live-site copy review

</inputs>

<outputs>

- context-bundle/README.md
- outputs/design-research-report.md
- outputs/design-research-brief.pdf
- outputs/open-gates.md
- plans/<slug>__concept.md
- plans/<slug>__content.md
- plans/<slug>__visual-spec.md
- plans/<slug>__wireframe.md
- plans/<slug>__plan.json
- plans/<slug>__plan.md
- outputs/picostrap-customizer-setting-map.md
- outputs/home-page__lc-html__v1.html
- outputs/header-partial__lc-html__v1.html
- outputs/footer-partial__lc-html__v1.html
- outputs/recordings/*.gif
- outputs/recordings/desktop__*.jpg
- outputs/recordings/xs__*.jpg
- outputs/email-to-client__design-direction-review.md
- outputs/email-to-client__draft-receipt.json

</outputs>
</quick_start>

<references>
  <ref path="guardrails.md" load="on_start">Safety rules and execution constraints</ref>
  <ref path="prompts/01_INTAKE_AND_RESEARCH.md" load="when_requested">— Intake and Research</ref>
  <ref path="prompts/02_DESIGN_SPEC.md" load="when_requested">— Design Spec</ref>
  <ref path="prompts/03_THEME_TOKENS.md" load="when_requested">— Theme Tokens (Picostrap Customizer)</ref>
  <ref path="prompts/04_PAGE_BUILD.md" load="when_requested">— Page Build (LiveCanvas)</ref>
  <ref path="prompts/05_CLIENT_REVIEW.md" load="when_requested">— Client Review</ref>
</references>

<workflows>
  <workflow name="run">
    <step>Run Prompt 01: — Intake and Research</step>
    <step>Run Prompt 02: — Design Spec</step>
    <step>Run Prompt 03: — Theme Tokens (Picostrap Customizer)</step>
    <step>Run Prompt 04: — Page Build (LiveCanvas)</step>
    <step>Run Prompt 05: — Client Review</step>
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
