# 12 — Dev Packet Generator (High Signal)

> **Type**: Atomic
> **Mode**: REVIEW_ONLY (no runs, no fixes)
> **Purpose**: Create a developer-facing packet that can be read in <10 minutes, with a small evidence map and clear next actions.
> **Agent-platform agnostic**: Works with any agent that has file access.

---

## Mode

- MODE = `REVIEW_ONLY` (no runs, no fixes)

---

## Inputs

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `RUNSET_ID`
- Optional: `INCLUDE_EXPORTS`: `true|false` (default false)

---

## Required reads

From:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/`

- `derived/runset.summary.md`
- `derived/runset.manager_report.md` (if present)
- Per env:
  - `<ENV>/derived/env.report.md` (if present)
  - `<ENV>/derived/run.summary.json`
  - `<ENV>/evidence/run.error.json` (if present)
  - `<ENV>/evidence/FAILURE.*.page.png` (if present)

If exports exist:
- `exports/compare/compare__<RUNSET_ID>__*.md`

---

## Output files to write

1) `For_Dev.md` (at repo root) OR `dev_handoff/For_Dev.md` (pick one and be consistent)
2) `dev_handoff/evidence.map.json` (top 10–20 artifacts with purpose tags)

`For_Dev.md` must include:
- What’s working (FACT)
- What’s broken (FACT + evidence paths)
- Most likely causes (HYPOTHESIS + fastest confirm)
- Questions/decisions needed from developer
- Repro steps using the framework CLI (exact commands)

---

## Optional: produce a portable bundle

```bash
node framework/runner/cli.js handoff --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --include-exports
```
