# 11 — Cross-run Anomaly Index (Trend + Regression)

> **Type**: Atomic
> **Mode**: REVIEW_ONLY (no runs, no fixes)
> **Purpose**: Build a cross-run index of recurring anomalies and regressions across many runsets, with stable buckets and evidence pointers.
> **Agent-platform agnostic**: Works with any agent that has shell + file access.

---

## Mode

- MODE = `REVIEW_ONLY` (no runs, no fixes)

---

## Inputs

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- Optional: `TAG_FILTER`: e.g. `smoke` or `release-2026-01-27`
- Optional: `EXPECTED_ENVS`: default `A,B,C`

---

## Step 1 — Generate a deterministic runset index (facts)

From `<PROJECT_ROOT>`:
```bash
node playwright_phased_runner/runner/tools/index-runsets.js --testcases_dir playwright_phased_runner/testcases --out_dir playwright_phased_runner/reports --expected_envs "<EXPECTED_ENVS>" --tag "<TAG_FILTER>"
```

This produces:
- `reports/runsets.index.json`
- `reports/runsets.index.md`

---

## Step 2 — Build anomaly buckets (LLM task)

Read:
- `reports/runsets.index.json`
- For each referenced runset/env, read:
  - `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/derived/run.summary.json`
  - `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/evidence/run.error.json` (if present)
  - `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.manager_report.md` (if present)

Produce:
- `reports/anomalies.index.json`
- `reports/anomalies.index.md`

Stable buckets (extend as needed):
- `PREFLIGHT_FAIL` (auth/storage/setup)
- `selector_drift`
- `validation_blocked_next`
- `popup_or_overlay_blocking`
- `conditional_page_mismatch`
- `timing_wait_timeout`
- `success_detection_false_negative`
- `backend_missing_entry` (requires exports)
- `backend_mapping_mismatch` (requires exports)

For each bucket:
- list affected `testcase_id/runset_id/env`
- one-sentence description of symptom
- 3–6 key evidence paths
- first-seen runset (if obvious) and suspected regression window

---

## Output constraints

- Keep it scannable; prefer evidence paths over pasted logs.
- Do not embed exports containing PII; cite filenames only.
