# 02 — Apply Bounded Edits

> **Type**: Atomic
> **Mode**: RUN_ONLY
> **Purpose**: Apply only the pre-approved content edits, save according to policy, and record the exact change set without expanding scope.

---

## Inputs

- `site-config.json`
- `edit-request.json`
- `success-criteria.md`
- `captures/capture-log.json`
- optional `selector-hints.json`

---

## Required Output

Write:

- `edits/edit-plan.json`

---

## Required `edit-plan.json` Fields

- target object identifiers
- requested publish policy
- detected editor type
- list of requested edits
- list of applied edits
- per-field result:
  - `applied`
  - `unchanged`
  - `missing_field`
  - `blocked`
- save action taken:
  - `none`
  - `saved_as_draft`
  - `updated_existing_draft`
  - `updated_published_with_approval`
- notes and blockers

---

## Procedure

1. Re-open the confirmed target object.
2. Reconfirm the object ID/slug/title before typing.
3. Apply only the edits enumerated in `edit-request.json`.
4. For each field:
   - capture the before value
   - apply the requested after value
   - note whether the field existed and whether the update landed in the editor
5. Save according to policy:
   - no save
   - save draft
   - update existing draft
   - update published object only if explicitly approved
6. Record the exact save action and any warnings.
7. If the requested edits are expected to change layout or presentation, capture immediate post-save screenshots of the same sections named in `captures/capture-log.json`.

---

## Hard Boundaries

- Do not publish unless the request explicitly authorizes it.
- Do not rewrite copy beyond the supplied scope.
- Do not change layout, design, taxonomy, menus, templates, or plugin settings.
- Do not mutate theme files, plugin files, builder-internal JSON, Code Snippets / WPCodeBox, or direct database/postmeta surfaces in this framework.
- Do not silently skip blocked fields; record them.

---

## Success Condition

This prompt is complete only when `edits/edit-plan.json` provides a field-level ledger of what was requested, what was applied, and what save action was taken.
