# 08 — Re-run Verification (post-fix)

> **Type**: Atomic
> **Mode**: RUN_ONLY (no fixes)
> **Purpose**: Re-run only the previously failing environment(s) after fixes, and produce a short verification report with evidence pointers.
> **Agent-platform agnostic**: Works with any agent that has shell access.

---

## Mode

- MODE = `RUN_ONLY` (no fixes)

---

## Safety rule (important)

**Do not reuse the old runset folder.** The runner writes into:
`playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/...`

Reusing the same `RUNSET_ID` risks overwriting or confusing evidence. Instead, allocate a **fresh runset** and tag it as a rerun of the reference runset.

---

## Inputs

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `REFERENCE_RUNSET_ID`: the runset that failed (evidence source)
- `ENVS_TO_RERUN`: e.g. `A-logged_out` or `A-logged_out,B-logged_in`
- Optional: `TAGS` (comma-separated). Recommended to include: `rerun,rerun_of_<REFERENCE_RUNSET_ID>`

---

## Procedure

1) Allocate a new runset:
```bash
node framework/runner/cli.js new-runset --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --tags "<TAGS>"
```

Record:
- `RERUN_RUNSET_ID`

2) Run each env in `ENVS_TO_RERUN`:
```bash
node framework/runner/cli.js run --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RERUN_RUNSET_ID>" --env "<ENV>"
```

3) Compile runset summaries:
```bash
node framework/runner/cli.js report --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RERUN_RUNSET_ID>"
```

4) Write a short verification note to disk:
- Runset-level: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RERUN_RUNSET_ID>/derived/rerun.verify.md`

Include:
- reference runset id
- rerun runset id
- env results table
- top evidence paths per env

---

## Minimal output to print in chat

- `RERUN_RUNSET_ID=...`
- PASS/FAIL per env
- paths created:
  - `.../derived/runset.summary.md`
  - `.../derived/runset.manager_report.md` (if you used the manager prompt)
  - `.../derived/rerun.verify.md`
