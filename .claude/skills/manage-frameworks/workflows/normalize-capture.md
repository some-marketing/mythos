# Normalize Capture Workflow

## Steps

1. **[AUTO] Read capture bundle** — Load `CAPTURE_META.json`, `goal.md`, `context.md`, `steps.jsonl`, `decisions.jsonl`, and `success_criteria.json`.
2. **[AUTO] Check completeness** — Confirm required files exist and contain non-placeholder content.
3. **[AUTO] Update readiness** — Mark the capture `ready_for_scaffold` only if the required structure is complete.
4. **[AUTO] Write report** — Create `NORMALIZATION_REPORT.md` with missing items and advisory notes.

## Output

- Updated capture metadata with normalization status
- `NORMALIZATION_REPORT.md`
