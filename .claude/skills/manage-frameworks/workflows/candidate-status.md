# Candidate Status Workflow

## Steps

1. **[AUTO] Read candidate metadata** — Load `candidate.json`.
2. **[AUTO] Summarize replay runs** — Count pass, fail, and partial replay results.
3. **[AUTO] Check promotion blockers** — Inspect `proposed_framework/` for missing files and likely contamination.
4. **[AUTO] Report readiness** — Show candidate status, replay summary, and whether promotion is currently allowed.

## Output

- Candidate readiness summary
- Replay counts
- Promotion blockers, if any
