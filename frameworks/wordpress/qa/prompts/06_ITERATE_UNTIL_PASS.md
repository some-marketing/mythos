# 06 — Iterate Until Pass (Playbook / Coordinator)

> **Type**: Playbook (coordinator)
> **Mode**: COORDINATOR (orchestrates other prompts across modes)

---

## Goal

Coordinate the end-to-end iteration loop (run → triage → walkthrough → implement fixes → rerun → report) until the testcase is stable across all required environments.

---

## Inputs (paths)

Standard inputs per `09_SHARED_BLOCKS.md` § A:
- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `GOAL`: what "PASS" means (include backend expectations if relevant)
- Optional: `TAGS` (comma-separated)
- Optional: `MAX_ITERATIONS` (default 5)
- Optional: `FAIL_FAST_SCOPE`: `A-only` or `A/B/C`

---

## Outputs (paths)

Per iteration:
- Runset evidence: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/`
- Manager report: `.../runs/<RUNSET_ID>/derived/runset.manager_report.md`
- Walkthrough findings (if used): `walkthrough_findings/WALKTHROUGH__*.md`
- Rerun verification: `.../runs/<RERUN_RUNSET_ID>/derived/rerun.verify.md`

Final:
- Stable PASS runset with all evidence
- Dev handoff (if requested): via `framework/prompts/03_REPORT_AND_DEV_HANDOFF.md`
- Export comparison (if GOAL includes backend): via `framework/prompts/10_DEEP_PIPELINE_ANALYSIS.md`

---

## Guardrails

- Per `09_SHARED_BLOCKS.md` § B (Operating Rules).
- Default: prefer deterministic evidence over speculation.
- Do not edit raw run artifacts except writing to `derived/`.
- Avoid sleeps unless you can explain why a deterministic wait is impossible.

---

## Delegation Plan (optional subagents)

Per `09_SHARED_BLOCKS.md` § G: If subagents are available, delegate sub-tasks; otherwise run sequentially.

Each iteration may delegate:

| Sub-task | Canonical Prompt | Mode | When |
|----------|-----------------|------|------|
| Parallel env run | `04_PARALLEL_RUN_MANAGER.md` | RUN_ONLY | Step 1 (A/B/C needed) |
| Walkthrough | `05_MCP_WALKTHROUGH_FINDINGS_ONLY.md` | FINDINGS_ONLY | Step 3 (UI/DOM ambiguous) |
| Implement fixes | `07_IMPLEMENT_FIXES.md` | PATCH_ALLOWED | Step 4 (fixes required) |
| Re-run verify | `08_RERUN_VERIFY.md` | RUN_ONLY | Step 4 (post-fix) |
| Report + handoff | `03_REPORT_AND_DEV_HANDOFF.md` | — | Step 5 (stable PASS) |
| Pipeline analysis | `10_DEEP_PIPELINE_ANALYSIS.md` | REVIEW_ONLY | Step 6 (backend proof) |

---

## Execution Steps (one iteration cycle)

### Step 0 — Validate Definitions (fast)

```bash
node framework/runner/cli.js validate --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>"
```

If validation fails, fix JSON/paths before running anything.

### Step 1 — Allocate + Run (baseline)

**If A/B/C needed:** Run `framework/prompts/04_PARALLEL_RUN_MANAGER.md` with parameters.

**If A-only (recommended early):**
```bash
node framework/runner/cli.js new-runset --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --tags "<TAGS>"
node framework/runner/cli.js run --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --env "A-logged_out"
node framework/runner/cli.js report --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>"
```

### Step 2 — Triage Failures (no browser)

Per failing env, read:
- `.../<ENV>/derived/run.summary.json`
- `.../<ENV>/evidence/run.error.json` (if present)
- `.../<ENV>/evidence/console.errors.summary.md` (if present)
- `.../<ENV>/evidence/FAILURE.*.page.png` (if present)

Classify into one bucket:
- `PREFLIGHT_FAIL` (auth/storage/setup)
- `selector / DOM drift`
- `timing / waits / page gating`
- `conditional logic / skipped pages`
- `validation / required fields`
- `backend mismatch` (only if UI PASS but exports mismatch)

### Step 2a — Stakeholder Interview Gate (when intent is unclear)

Per `09_SHARED_BLOCKS.md` § F: If triage reveals ambiguities about intended behavior, **pause** and ask clarifying questions before proceeding to fixes.

Examples:
- "This field was empty in all envs — is that expected behavior or a regression?"
- "Env B differs from A for field Y — is that the intended logged-in behavior?"
- "The form skipped page 3 — is that conditional logic or a bug?"

Record answers to `.../<RUNSET_ID>/derived/stakeholder_answers.md`.
Apply classification: expected behavior → skip fix, unexpected → proceed to fix, unknown → escalate.

### Step 3 — Walkthrough (only when UI/DOM is ambiguous)

If live DOM truth is needed (selectors, popups, conditional pages, widgets):
- Run `framework/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md` (findings only, no fixes).

### Step 4 — Implement Minimal Fixes + Re-run

If fixes are required:
1. Run `framework/prompts/07_IMPLEMENT_FIXES.md` with evidence from Steps 2–3.
2. Re-run only failing envs using `framework/prompts/08_RERUN_VERIFY.md`.

### Step 5 — Report + Dev Handoff

After stable PASS runset:
- Run `framework/prompts/03_REPORT_AND_DEV_HANDOFF.md`.
- Optionally produce portable bundle:
  ```bash
  node framework/runner/cli.js handoff --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>"
  ```

### Step 6 — Backend Proof (if required by GOAL)

If GOAL includes CRM/WPForms correctness:
- Download exports into `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/`.
- Run `framework/prompts/10_DEEP_PIPELINE_ANALYSIS.md`.

---

## Stop Conditions

**Stop iterating when:**
- All required envs are PASS, AND
- Any required backend comparisons match expectations (if part of GOAL).

**Escalate when:**
- Repeated PREFLIGHT_FAIL (auth/storage is stale)
- Exceeded `MAX_ITERATIONS` without reducing failure scope
- Site/form behavior is inconsistent across runs without a deterministic gating strategy

---

## Acceptance Criteria

- [ ] All required envs achieve PASS status
- [ ] Backend comparisons pass (if part of GOAL)
- [ ] Iteration count ≤ MAX_ITERATIONS
- [ ] Each iteration has a runset with evidence
- [ ] Stakeholder Interview Gate run when triage found ambiguities
- [ ] All fixes are traced (change → evidence mapping)
- [ ] Final report/handoff produced

---

## Failure Modes / Escalation

| Condition | Action |
|-----------|--------|
| PREFLIGHT_FAIL repeated | Escalate: auth/storage state likely stale; needs manual refresh |
| MAX_ITERATIONS exceeded | Stop; produce report of remaining failures; recommend manual investigation |
| Form behavior inconsistent across runs | Document flakiness pattern; recommend deterministic gating strategy |
| Walkthrough contradicts evidence | Trust live DOM (walkthrough) over stale evidence |
| Backend exports unavailable | Complete UI iteration; defer backend proof until exports available |
