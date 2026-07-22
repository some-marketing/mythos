# 07 — Implement Fixes (PATCH_ALLOWED)

> **Type**: Atomic
> **Mode**: PATCH_ALLOWED
> **Purpose**: Apply the smallest set of repo changes needed to fix failing envs, using run artifacts and walkthrough findings as the source of truth.
> **Agent-platform agnostic**: Works with any agent that has file editing capability.

---

## Mode

- MODE = `PATCH_ALLOWED`

---

## Operating Rules

Use: `framework/prompts/09_SHARED_BLOCKS.md` → **Operating Rules**.

Additional constraints:
- Do not edit files under `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/...` except writing new files under `derived/`.
- Prefer robust selectors and deterministic waits over sleeps.
- Keep scope tight: fix the first actionable root cause first.

---

## Inputs

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `FAILING_ENVS`: e.g. `A-logged_out,B-logged_in`
- `REFERENCE_RUNSET_ID`: the runset you are fixing (the evidence source)
- `GOAL`: success definition
- Optional: `WALKTHROUGH_FINDINGS_PATHS` (one or more)
- Optional: `EXTRA_CONTEXT` (links to tickets, known site changes, etc.)

---

## Required evidence to read (per failing env)

From:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<REFERENCE_RUNSET_ID>/<ENV>/`

- `derived/run.summary.json`
- `evidence/run.error.json` (if present)
- `evidence/console.errors.summary.md` (if present)
- `evidence/FAILURE.*.page.png` (if present)
- `evidence/submit.result.json` (if present)

Also read testcase assets:
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/testcase.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/locator_map.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/identity.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/EXPECTED_OUTCOMES.md` (if present)

---

## Fix procedure

1) **Identify root cause** (one sentence) per failing env, but prioritize the earliest shared root cause.

2) **Pick the smallest fix surface**:
- Selector drift → update `locator_map.json`
- Wrong test values → update `identity.json`
- Pre-form navigation changes → update `testcase.json`
- Runner behavior bug → update `<PROJECT_ROOT>/runner/run-phased.js` (or wrapper/tooling)

3) **Implement changes** with traceability:
For every change, record:
- `change → file → why → evidence path(s)`

4) **Validate definitions**:
```bash
node framework/runner/cli.js validate --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>"
```

5) **Targeted verification**:
- Do not re-run A/B/C blindly.
- Use `framework/prompts/08_RERUN_VERIFY.md` to rerun only failing env(s) in a fresh runset tagged as a rerun.

---

## Output (in chat)

Return:
- files changed (paths)
- a brief mapping of `change → evidence` (paths only)
- exact commands you ran (if any)
- what envs you expect to be fixed by the change
