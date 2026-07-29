# 05 — Publish Or Freeze And Handoff

> **Type**: Atomic
> **Mode**: RUN_ONLY
> **Purpose**: Execute the final publish-or-freeze decision and write the operator-facing record of what happened.

---

## Inputs

- `edit-request.json`
- `edits/edit-plan.json`
- `reports/verification-report.json`
- `reports/review-gate.md`

---

## Required Outputs

Write:

- `handoff/publish-report.json`
- `handoff/change-summary.md`

---

## Procedure

1. Read `reports/review-gate.md`.
2. If the decision is `ready_for_publish` and publish approval exists:
   - publish the target object
   - confirm final status
   - capture the final live URL
3. If the decision is `leave_as_draft`:
   - do not publish
   - confirm the object remains in the intended non-published state
4. If the decision is `freeze_for_review`:
   - do not publish
   - leave the object in the safest verified state
   - record what blocked completion

---

## Required `publish-report.json` Fields

- target object identifiers
- decision received
- action taken
- final status
- final URL if published
- unresolved issues
- rollback notes
- timestamp

---

## Required `change-summary.md` Sections

- target object
- approved scope
- edits applied
- verification result
- final status
- unresolved items
- rollback notes

---

## Rules

- Never override the review gate.
- Never publish if approval is missing.
- Never hide verification failures in the handoff.
- For multi-page batches, produce page-level results, not a blended single summary.
