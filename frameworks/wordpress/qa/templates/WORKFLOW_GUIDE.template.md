# QA Testing Workflow — {{CLIENT_NAME}} ({{CLIENT_CODE}})

Project: `{{PROJECT_NAME}}`
Framework: WordPress QA (Playwright browser testing)

---

## What This Does

Tests your WordPress site across multiple browser environments (logged out, logged in, incognito) to verify forms, tracking, and page behavior work correctly. Produces evidence-backed reports for your developer.

## Before You Start

You'll need:
- [ ] The site URL to test
- [ ] Login credentials (if testing logged-in behavior)
- [ ] A list of forms/pages to verify

## Step-by-Step

### Step 1: Set Up a Testcase
**Command:** `/qa:intake`
**You provide:** Site URL
**What happens:** Claude walks the site, identifies form fields and page elements, and creates a testcase folder with a locator map.
**Output:** `playwright_phased_runner/testcases/<testcase-id>/`

### Step 2: Verify Locators
**Command:** `/qa:locator-correct <testcase-id>`
**You provide:** The testcase ID from Step 1
**What happens:** Claude re-walks the site in a browser to verify every selector works. Reports any that fail.
**Output:** Findings report (no files changed)

### Step 3: Fix Any Locator Issues
**Command:** `/qa:fix <testcase-id>`
**You provide:** The testcase ID
**What happens:** Applies minimal fixes to the locator map based on the findings from Step 2.
**Output:** Updated testcase files

### Step 4: Run Tests
**Command:** `/qa:parallel-run <testcase-id>`
**You provide:** The testcase ID
**What happens:** Runs the testcase across all environments (A/B/C) in parallel. No files are modified.
**Output:** Per-environment pass/fail results with a runset ID

### Step 5: Review Results
**Command:** `/qa:report <testcase-id> <runset-id>`
**You provide:** Testcase ID and runset ID from Step 4
**What happens:** Analyzes results and produces a developer handoff report.
**Output:** Report with evidence, hypotheses, and open questions

### Step 6 (If Failures): Fix and Re-run
**Command:** `/qa:iterate <testcase-id>`
**What happens:** Loops through fix → re-run → check until all environments pass or the limit is reached.

### Step 7 (Optional): Build Developer Handoff
**Command:** `/qa:compile-dev-bundle <testcase-id> <runset-id>`
**What happens:** Creates a comprehensive developer handoff bundle with payload analysis, evidence, and questions.

---

## Command Quick Reference

| Step | Command | When to Use |
|------|---------|-------------|
| Setup | `/qa:intake` | Starting a new testcase |
| Verify | `/qa:locator-correct <id>` | After intake, before first run |
| Fix | `/qa:fix <id> <runset>` | After failures are identified |
| Run | `/qa:parallel-run <id>` | Execute tests across environments |
| Report | `/qa:report <id> <runset>` | After a run completes |
| Iterate | `/qa:iterate <id>` | Fix-and-rerun loop until pass |
| Dev Bundle | `/qa:compile-dev-bundle <id> <runset>` | Building developer handoff |
| Dev Packet | `/qa:dev-packet <id> <runset>` | Quick 10-min developer summary |
| Pipeline | `/qa:pipeline-analysis <id> <runset>` | Deep data pipeline trace |
| Changelog | `/qa:changelog-capture` | Capture developer changelog |
| Expectations | `/qa:expectation-update <id>` | Update test expectations after code changes |
| Re-run | `/qa:rerun <id> <runset> <envs>` | Re-run specific failed environments |

## What the Modes Mean

- **FINDINGS_ONLY**: Claude observes and reports. No files changed.
- **RUN_ONLY**: Tests execute but no fixes applied.
- **PATCH_ALLOWED**: Small, targeted fixes only.
- **REVIEW_ONLY**: Analysis and reporting only.

## Troubleshooting

### Locators aren't resolving after intake
The site may have changed since intake. Run `/qa:locator-correct <id>` to identify which selectors are stale, then `/qa:fix <id>` to patch them.

### Tests pass but backend data is wrong
UI automation passed but CRM/WPForms data doesn't match expectations. Run `/qa:pipeline-analysis <id> <runset>` to trace values through the full data pipeline.

### Iteration loop hits the cap without passing
After 5 fix-and-rerun cycles, the issue is likely not a selector/timing problem. Run `/qa:compile-dev-bundle <id> <runset>` to build a developer handoff and escalate.

### "PREFLIGHT_FAIL" on a run
Usually means auth state is missing or the site is unreachable. Check credentials and site URL, then re-run.

### Developer made code changes — do I need to re-run?
Yes. First capture the changelog with `/qa:changelog-capture`, then update expectations with `/qa:expectation-update <id>`, then re-run with `/qa:parallel-run <id>`.
