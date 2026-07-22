# 04 — Parallel Run Manager (A/B/C) + Triage (Playbook)

> **Type**: Playbook (orchestrator)
> **Mode**: RUN_ONLY (no fixes, no reruns)

---

## Goal

Allocate a runset, run the testcase in parallel for the target environments (typically A/B/C), then produce per-env run notes and a manager summary report.

**CRITICAL**: If errors are encountered, **ONLY REPORT them**. Do NOT attempt to fix issues, modify selectors, update code, or rerun tests.

---

## Inputs (paths)

Standard inputs per `09_SHARED_BLOCKS.md` § A:
- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`: e.g. `wpforms_88839_from_vdp_vsn_apply`
- `ENVS`: default `A-logged_out,B-logged_in,C-incognito` (override as needed)
- `TAGS` (optional): comma-separated tags for `runset.meta.json`

---

## Outputs (paths)

- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/derived/env.report.md` (per env)
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.manager_report.md`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.summary.md` (from report command)

---

## Guardrails

- Per `09_SHARED_BLOCKS.md` § B (Operating Rules) — mode is RUN_ONLY.
- Do NOT attempt fixes, modifications, or reruns.
- Subagents must not propose or apply fixes.
- Document errors; do not diagnose root cause beyond surface-level analysis.

---

## Delegation Plan (optional subagents)

Per `09_SHARED_BLOCKS.md` § G: If subagents are available, delegate per-env runs in parallel; otherwise run sequentially.

| Sub-task | Subagent | Inputs | Outputs |
|----------|----------|--------|---------|
| Run env A | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=A-logged_out | env.report.md, structured status |
| Run env B | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=B-logged_in | env.report.md, structured status |
| Run env C | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=C-incognito | env.report.md, structured status |
| **Manager (you)** | — | Per-env outputs | runset.manager_report.md |

### Model selection (optional)
- Manager: high-reliability model (trusted to follow "NO FIXES" constraint).
- Subagents: same model as manager (recommended). If cheaper model used, restrict to mechanical work and verify they did not propose fixes.

---

## Execution Steps

### Step 0 — Allocate Runset

```bash
node framework/runner/cli.js new-runset --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --tags "<TAGS>"
```

Parse stdout. Record `RUNSET_ID` and `RUNSET_META` path. If no tags, omit `--tags`.

### Step 0a — Changelog Check (GATE: post-fix verification run)

**Trigger:** User indicates this is a re-run after developer fixes (e.g., "rerun after fix", "verification run", "post-patch run").

If triggered:

1. Check for changelog at `playwright_phased_runner/changelogs/LATEST.txt`
2. If LATEST.txt exists, read the referenced changelog file
3. If missing or outdated (older than fixes being verified), ask:

```
This appears to be a post-fix verification run.

Has the developer created a changelog documenting the fixes?

Options:
A) Provide changelog file path: [paste path]
B) Run /framework:changelog-capture to interview the developer
C) Skip changelog (will be created after verification passes)
```

4. If user provides a changelog path:
   - Validate file exists and has expected structure
   - Copy to canonical location if not already there
   - Update LATEST.txt pointer

5. Record `changelog_status`: `PRESENT` | `ABSENT` | `SKIPPED`

**STOP and wait for user response before proceeding.**

If user does NOT indicate this is a post-fix run, set `changelog_status = N/A` and proceed.

### Step 1 — Run Environments (parallel if subagents available)

Spawn one agent per env. Each receives the **Subagent Instructions** below.

### Step 2 — Manager Triage (report only)

After all envs complete:

1. Compile report:
   ```bash
   node framework/runner/cli.js report --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>"
   ```

2. For each non-PASS env, read (fast triage):
   - `.../<ENV>/derived/run.summary.json`
   - `.../<ENV>/evidence/run.error.json` (if present)
   - `.../<ENV>/evidence/console.errors.summary.md` (if present)
   - Failure screenshots under `.../evidence/`

3. **REPORT errors only.** Do NOT fix or diagnose beyond surface-level.

### Step 3 — Write Manager Report

Write to: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.manager_report.md`

Per template in `09_SHARED_BLOCKS.md` § C.2. Include:
- Metadata (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENVS, tags)
- Overall status: `ALL_PASS` | `SOME_FAILED` | `BLOCKED`
- Results table: `env | status | run folder | submit.success | primary failure reason | key evidence paths`
- Links to `runset.summary.md` and per-env `env.report.md`

### Step 4 — Stop (do NOT fix)

**CRITICAL**: After writing the manager report, **STOP**.

Final output:
1. Paths to all generated reports
2. Overall status summary (ALL_PASS / SOME_FAILED / BLOCKED)
3. List of failures (if any)
4. Changelog status (from Step 0a):
   - `PRESENT`: "Changelog available at [path]"
   - `ABSENT`: "No changelog found — dev should create one after fixes"
   - `SKIPPED`: "Changelog collection skipped by user"
   - `N/A`: "Initial run (not a post-fix verification)"

**If ALL_PASS:**
All environments passed test execution. Note: passing tests confirm form submission
completed — backend validation (CRM records, payload correctness) requires verification.

Recommended next steps:
- `/framework:compile-dev-bundle` — Validate CRM payload correctness and create developer handoff
- `/framework:report` — Generate detailed runset report
- `/framework:anomaly-index` — Cross-run pattern analysis (if multiple runsets exist)
- Run additional testcases

If this was a post-fix verification run and changelog is ABSENT:
- `/framework:changelog-capture` — Interview developer to document the fixes

Ask: "All environments passed. Would you like to:
1. Validate CRM/payload correctness (compile-dev-bundle)
2. Generate detailed report
3. Run anomaly analysis
4. Capture dev changelog (if fixes were made)
5. Run another testcase
6. Done for now"

**If SOME_FAILED or BLOCKED:**
Recommend next prompt based on failure type:
- Selector/flow fixes: `/framework:locator-correct`
- Deep analysis: `/framework:pipeline-analysis`
- Developer handoff: `/framework:report`

Ask: "Which next step would you like to take?"

---

## Subagent Instructions (one env only)

**CRITICAL**: Do NOT attempt fixes, modifications, or reruns. Your sole job: execute, capture evidence, report.

### Inputs
- `PROJECT_ROOT`, `TESTCASE_ID`, `RUNSET_ID`, `ENV` (e.g. `A-logged_out`)

### Run command
```bash
node framework/runner/cli.js run --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --env "<ENV>"
```

### Required output
Return structured report:
- `status`: `PASS` | `FAIL` | `PREFLIGHT_FAIL`
- `run_folder`: full path to `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/`
- `submit_success`: true/false/unknown
- `top_issue`: one sentence (or "None")
- `evidence_paths`: 3–6 most relevant files

Write: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/derived/env.report.md`
Per template in `09_SHARED_BLOCKS.md` § C.1.

**Do NOT**: analyze screenshots with browser tools, fix selectors, rerun tests, modify code, or investigate beyond reading evidence files.

---

## Acceptance Criteria

- [ ] Runset allocated with unique ID
- [ ] If post-fix verification run: changelog check (Step 0a) executed with user prompt
- [ ] Changelog status recorded: PRESENT | ABSENT | SKIPPED | N/A
- [ ] All requested envs executed
- [ ] Per-env `env.report.md` files exist
- [ ] `runset.manager_report.md` exists with results table
- [ ] Final summary includes changelog status
- [ ] No fixes attempted or proposed
- [ ] Evidence paths in reports are valid
- [ ] If ALL_PASS and changelog ABSENT: changelog-capture offered as option

---

## Failure Modes / Escalation

| Condition | Action |
|-----------|--------|
| Runset allocation fails | Check CLI is accessible; report error |
| Env run crashes mid-execution | Record FAIL status with error; do not retry |
| All envs fail (BLOCKED) | Report BLOCKED; recommend checking testcase definitions |
| Subagent proposes fixes | Manager rejects; re-verify no code changes made |
