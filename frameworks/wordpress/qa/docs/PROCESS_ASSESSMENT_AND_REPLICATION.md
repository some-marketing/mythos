# Process Assessment + Replication Guide (Phased Runner Framework)

This document explains what this framework is, how the process works end-to-end, what we changed as it evolved, and how to replicate it cleanly for other web projects.

This repo currently contains:
- A **project-specific Playwright runner pack** under `playwright_phased_runner/` (optimized for a reference WPForms flow).
- A **project-agnostic prompt + workflow layer** under `framework/prompts/` and `framework/docs/` (intended to become a reusable template repo).

---

## 1) What This Framework Is

At its core, this is an **evidence-first testing system**:

1) Run a real browser automation for a user journey (A/B/C environment matrix).
2) Persist high-signal evidence (screenshots, console, cookies, navigation, dataLayer, submit result).
3) Pull backend exports (CRM/WPForms) to validate that what “should have happened” actually happened.
4) Use an LLM-driven loop (Claude findings → GPT fixes → Claude rerun) to make the test stable and maintainable.

The key design decision: **treat artifacts as the product**. The automation is just how we generate them.

---

## 2) Core Concepts (Vocabulary)

### Testcase
A single “thing we are testing” on a site (e.g. “baseline lead form submission with attribution tokens”).

Implementation: `playwright_phased_runner/testcases/<TESTCASE_ID>/` with:
- `testcase.json` (URLs + pointers + auth state pointers)
- `locator_map.json` (what to fill/click per page)
- `identity.json` (test values; templated per env/run)
- mapping contracts (`fields_mapped_to_crm.csv`, `system_fields_mapped_to_crm.csv`)
- `EXPECTED_OUTCOMES.md`

### Runset
A grouped set of runs executed together under one ID (e.g. `run_0006`). A runset usually contains A/B/C.

Implementation: `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/`

### Environment (A/B/C)
Standard matrix used to compare behavior:
- **A**: logged out baseline
- **B**: logged in (requires storageState JSON)
- **C**: incognito-like baseline (fresh context)

### “Phases” (P1–P5)
The phased runner is opinionated for attribution testing:
- **P1**: go to *decorated* landing URL (UTM tokens present)
- **P2**: idle/wait window (captures delayed scripts/cookies)
- **P3**: go to direct homepage (non-decorated)
- **P4**: go to apply URL
- **P5**: fill multipage form + submit

---

## 3) How the Process Works (Current Loop)

This is the canonical iteration flow (also see `framework/docs/FUTURE_ITERATION_FLOW.md`):

1) **Scaffold** (LLM-assisted)
   - Generate initial `locator_map.json` + `identity.json` (best guess from DOM).

2) **Walkthrough (Findings-Only)** (Claude via MCP)
   - Manually traverse the live flow in a browser.
   - Output a *new* findings doc (never overwrite) describing: conditional fields, popups, async transitions, widget quirks, and gating conditions.

3) **Correct**
   - Update configs (and runner only if needed) based on findings.

4) **Run A/B/C**
   - Create a runset (`npm run run:runset:new`) then run each env under that runset.
   - Generate structured artifacts per env.
   - Write neutral reports under `playwright_phased_runner/reports/`.

5) **Backend verification**
   - Export from CRM + WPForms admin panels.
   - Store at runset level under `.../exports/` (not per env).

6) **Compare + synthesize**
   - Diff “automation proof” vs “backend proof”.
   - Produce dev-ready QA reports + mapping coverage.

7) **Decide**
   - If A/B/C pass and backend matches: done.
   - If UI fails: walkthrough findings then fix and rerun.
   - If backend mismatch: investigate attribution pipeline (not automation).

---

## 4) What the Runner Produces (Why It’s Useful)

For each env run, you get:
- **Console events**: `evidence/console.events.jsonl` (+ `console.errors.summary.md`)
- **dataLayer pushes**: `evidence/datalayer.events.jsonl` (+ `datalayer.summary.json`)
- **Submit proof**: `evidence/submit.result.json`
- **Screenshots**: `evidence/P1.page.png`, `P3.page.png`, `P4.page.png`, `P5.submit.page.png`
- **Cookies**: `cookies/P1..P5.cookies.json` (+ `P0` for env B)
- **Derived summaries**: `derived/run.summary.json` + `derived/run.summary.md`

Why this matters:
- It reduces “it flaked” to “here’s the exact evidence of what happened”.
- It supports both humans and machines (structured JSON + readable MD).

---

## 5) Streamlining Opportunities (High-Value Next Improvements)

### A) Make backend verification deterministic
Right now, the CRM/WPForms exports are manual and analysis is semi-manual.

Recommended improvements:
- Add a deterministic tool (e.g. `runner/tools/compare-exports.js`) that:
  - ingests the runset exports + mapping contracts
  - outputs a single canonical compare report under `.../exports/compare/`
  - emits “master lists”:
    - mapped + present
    - mapped + missing/empty
    - unmapped + present

### B) Reduce prompt duplication further
We already consolidated many rules into shared blocks, but the next wins are:
- Keep one canonical “Run Report Template”
- Make all run-monitor/rerun/report prompts reference it (don’t restate structure)

### C) Add a single-command A/B/C run orchestrator
Today the runner is invoked per env. A thin orchestrator would:
- allocate runset
- run A/B/C (parallel)
- compile runset summary
- optionally emit a manager report

This improves usability for humans and makes CI integration easier.

### D) Standardize a “proof contract” per testcase
Each testcase should explicitly declare:
- which **evidence is required** (dataLayer events, console proof, network calls, backend fields)
- which are “nice-to-have”

We just added one proof mechanism: **expected console log** for a GTM “test tag fired” message.

### E) Make “replication” one copy/paste action
Convert the template layer into a standalone “template repo” that a user copies into any project:
- install node deps
- create a testcase folder
- run prompts to scaffold
- run tests
- handoff bundle

The direction is already documented in `framework/docs/TEMPLATE_REPO_SPEC.md`.

---

## 6) Replicating This For Another Web Project

### What to copy as a starting point
- Prompt suite: `framework/prompts/`
- Process docs: `framework/docs/FUTURE_ITERATION_FLOW.md`, `framework/docs/PROCESS_ASSESSMENT_AND_REPLICATION.md`, `framework/docs/CHANGELOG.md`
- Runner pack: `playwright_phased_runner/` (or eventually extract to its own repo/package)

### What must be created per new site/test
- A new testcase folder: `playwright_phased_runner/testcases/<TESTCASE_ID>/`
- `testcase.json` pointing at the site URLs
- `locator_map.json` matching the target journey
- `identity.json` with templated test data
- backend mapping contracts (`fields_mapped_to_crm.csv`, `system_fields_mapped_to_crm.csv`) if backend verification is in scope
- a shared auth state for logged-in envs: `playwright_phased_runner/auth_states/<site>/B-logged_in.storage.json` (when needed)

### The minimum loop for a brand new site
1) Scaffold locator map + identity
2) Walkthrough (findings-only)
3) Correct
4) Run A/B/C and verify evidence
5) Add backend exports and compare

---

## 7) What We’ve Done Since The Phased Runner Was Introduced

Patch notes are tracked in:
- `framework/docs/CHANGELOG.md` (framework-level changes)
- `archive/2026-01-28/docs/changes/CHANGES_2026-01-24.md` (detailed file-level change log)

High-level evolution:
- Imported the phased runner pack and added platform-resilience wrappers (macOS arm64 + temp dir handling).
- Reworked multipage WPForms gating (visibility selectors and click behavior) based on walkthrough findings.
- Added popup/interstitial handling to stabilize the multipage flow.
- Introduced **runsets** as a first-class unit (allocator + metadata).
- Introduced a unified prompt suite and shared blocks to reduce drift across prompts.
- Switched to a neutral `playwright_phased_runner/reports/` folder (not “failure-only”).
- Added a developer handoff bundle generator (`npm run run:handoff:new`).
- Added a deterministic proof option for tracking: **expected console log assertion** (`expected_console_log_contains`) with artifact `evidence/expected_console_logs.json`.

---

## 8) What To Hand A Developer (Practical)

Best option: generate a bundle:
- `playwright_phased_runner/dev_handoff/DEV_HANDOFF__<TESTCASE_ID>__<RUNSET_ID>__<timestamp>/`

What they should read first:
- `reports/FINAL_TEST_REPORT__*.md`
- `reports/MAPPING_COVERAGE_MASTER_LIST__*.md`
- `reports/PHASED_RUN_REPORT__<RUNSET_ID>__*.md`
