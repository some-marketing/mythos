# 01 — Admin Recon And Pre-Edit Capture

> **Type**: Atomic
> **Mode**: FINDINGS_ONLY
> **Purpose**: Log into WordPress admin, confirm the target object, detect the active editor surface, and capture the full pre-edit state before any mutation.

---

## Inputs

- `site-config.json`
- `edit-request.json`
- optional `selector-hints.json`

---

## Required Outputs

Write:

- `captures/capture-log.json`

Optional evidence:

- `captures/screenshots/*.png`
- `captures/visual-baseline/*.png`

---

## Required Capture Fields

`captures/capture-log.json` must include:

- timestamp
- site URL
- edit URL
- target post ID
- target title
- target slug
- target post type
- current status (`draft`, `pending`, `published`, etc.)
- detected editor type
- frontend URL if available
- requested publish policy
- whether the requested edits are visual/layout-affecting
- per-field pre-edit values for every field in scope
- any editor drift, warnings, or blockers
- baseline screenshot paths for any section expected to change visually

---

## Procedure

1. Log into WordPress admin using the credential reference from `site-config.json`.
2. Navigate to the exact target object from `edit-request.json`.
3. Confirm the page/post/CPT matches the requested ID, slug, or title.
4. Detect the editor:
   - Gutenberg
   - Classic Editor
   - known page builder
   - unknown/custom
5. Capture the current field state for every approved editable field.
6. Capture screenshots of:
   - the editor shell
   - each scoped field area
   - the status/publish box
   - the rendered frontend page if accessible
7. If the requested edits can affect layout, spacing, styling, media placement, or section composition:
   - capture before screenshots of the exact frontend sections expected to change
   - capture source-of-truth/reference screenshots when available
   - record stable labels for each comparison target so verification can capture the same sections later
8. Record any blockers:
   - missing field
   - hidden field
   - selector drift
   - status mismatch
   - wrong target object

---

## Rules

- Do not change field values.
- Do not click save, update, or publish.
- Do not "fix while you are here."
- If the editor is unknown, stop after capture and flag `blocked_for_review`.
- Do not treat page-level screenshots alone as enough for visual work; capture section-level baselines when visuals matter.

---

## Success Condition

This prompt is complete only when pre-edit evidence exists for every field in scope, the target object is confirmed, and any layout-affecting scope has matching visual baselines for later comparison.
