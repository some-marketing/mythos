---
name: run
description: Run the full framework pipeline
skill: livecanvas-onepager-build
mode: PATCH_ALLOWED
arguments:
  - name: client.json
    description: SM_OS client registry record (brand block: wordmark font, colours, services list, live-site URL, demo-site URL)
    required: true
  - name: intake.json
    description: Kickoff form answers: business description, service area, audience (B2C/B2B), top services in priority order, high-stakes trigger, top comparison factors, differentiator, elevator pitch, credentials, named competitors, inspiration sites, style preference, assets on hand, target search phrases
    required: true
  - name: context-bundle/
    description: Kickoff-call transcript (verbatim), raw questionnaire answers, brand assets (card front/back, logo exports), all client-supplied photos with a hero-quality rating table, current live-site copy review
    required: true
  - name: reference_page_html.md
    description: A previous LiveCanvas page from the same agency as a markup-conventions reference (section per band, .lc-block wrappers, editable attrs)
    required: false
  - name: 1password_item
    description: 1P item title resolving to the demo site's wp-admin user/pass; never inlined. The run may instead use an already-authenticated Chrome session.
    required: false
---

Execute the full framework prompt chain from start to finish, ensuring all phases are completed and validated against the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Identify the project context and output directory.
3. Run Prompt 01: — Intake and Research
4. Run Prompt 02: — Design Spec
5. Run Prompt 03: — Theme Tokens (Picostrap Customizer)
6. Run Prompt 04: — Page Build (LiveCanvas)
7. Run Prompt 05: — Client Review
8. For each phase: execute the prompt, verify outputs, and record progression.
9. After the final phase: validate all output artifacts against the manifest's `output_contract`.
10. Run `/debrief-run` to capture session learnings and artifacts.

Follow `guardrails.md` for all execution constraints.
