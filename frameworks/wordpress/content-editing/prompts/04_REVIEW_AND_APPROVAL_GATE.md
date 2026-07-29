# 04 — Review And Approval Gate

> **Type**: Atomic
> **Mode**: REVIEW_ONLY
> **Purpose**: Synthesize capture, edit, and verification artifacts into a publish decision or freeze decision.

---

## Inputs

- `edit-request.json`
- `success-criteria.md`
- `captures/capture-log.json`
- `edits/edit-plan.json`
- `reports/verification-report.json`

---

## Required Output

Write:

- `reports/review-gate.md`
- `reports/visual-review.md` when visual acceptance is required

---

## Required Sections

`reports/review-gate.md` must include:

- target object summary
- requested publish policy
- what changed
- what verified cleanly
- visual review outcome
- unresolved blockers or drift
- decision:
  - `ready_for_publish`
  - `leave_as_draft`
  - `freeze_for_review`
- explicit rationale for the decision

---

## Decision Rules

Return `ready_for_publish` only if:

- publish is explicitly authorized
- verification passed
- no scoped field is missing or materially wrong
- link checks passed
- object status transitions are understood
- visual acceptance passed when the edit scope can affect layout or presentation

Return `leave_as_draft` if:

- the content landed cleanly
- publish approval is absent
- or the workflow is intentionally draft-first
- or visual review has not been completed yet for layout-affecting work

Return `freeze_for_review` if:

- verification failed
- the wrong object may have been edited
- editor drift prevented reliable edits
- the rendered page does not match the request
- the page passes technical checks but still looks visually wrong

---

## Rules

- Do not publish during this prompt.
- Do not add new edits.
- Make the decision only from existing artifacts.
- Judge visual acceptance from live-page screenshots or paired baseline/reference captures, not from editor-state alone.
