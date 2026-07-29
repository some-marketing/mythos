# 03 — Verify Editor And Frontend

> **Type**: Atomic
> **Mode**: RUN_ONLY
> **Purpose**: Verify that the requested edits actually landed in the editor and, when applicable, in the rendered frontend experience.

---

## Inputs

- `edit-request.json`
- `success-criteria.md`
- `captures/capture-log.json`
- `edits/edit-plan.json`

---

## Required Output

Write:

- `reports/verification-report.json`

Optional evidence:

- `reports/screenshots/*.png`
- `reports/visual-review.md`

---

## Verification Checklist

For each field in scope, verify:

- editor value matches the intended post-edit value
- rendered frontend value matches when a frontend URL exists
- status matches policy (`draft`, `published`, etc.)
- new or changed links resolve to the intended target
- no obvious editor save failure occurred

Also verify:

- the target object did not unexpectedly change title/slug/status
- the page still renders
- no blocked fields were incorrectly reported as applied

If the requested edits can affect layout, spacing, styling, media placement, or page composition, also verify:

- pre-edit and post-edit captures exist for the same named sections
- the rendered page is reviewed on the live frontend, not only in the editor
- each named section is compared against:
  - pre-edit state
  - source/reference state when available
- visual acceptance covers:
  - alignment
  - centering
  - spacing
  - width/fit within the page layout
  - media placement
  - CTA/button fit
- "technically rendered but visually off" is recorded as a failure, not a note

---

## Required `verification-report.json` Fields

- target object identifiers
- verification timestamp
- per-field verification results
- editor-state verdict
- frontend-state verdict
- status verdict
- link-check results
- visual-review requirement:
  - `not_required`
  - `required_and_passed`
  - `required_and_failed`
- overall outcome:
  - `pass`
  - `pass_with_notes`
  - `fail`
- evidence paths

---

## Rules

- Do not make new edits during verification.
- If verification exposes a problem, record it and stop.
- Do not publish from this step.
- If visual review is required, do not mark the run as passing until the live-page visuals have been compared against the captured baseline/reference sections.

---

## Success Condition

This prompt is complete only when the saved content, rendered content, object status, and any required visual comparison have been checked against the requested scope.
