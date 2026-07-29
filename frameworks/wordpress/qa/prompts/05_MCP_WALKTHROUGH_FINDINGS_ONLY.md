# 05 — MCP Walkthrough (Findings Only, No Fixes)

> **Type**: Atomic
> **Mode**: FINDINGS_ONLY
> **Purpose**: Troubleshoot automation flows by executing the flow as-if-runner, writing a findings document only.
> **Agent-platform agnostic**: Works with Playwright MCP, browser agent, or equivalent. If no browser available, document what would need to be checked manually.

## Goal
Troubleshoot automation flows (selectors, waits, conditionals, popups, hidden fields, page transitions) by executing the flow **as if you were the runner**, and writing a **findings document only**.

This is the canonical “observe and report” prompt. It intentionally produces **no patches** so implementation can be done separately.

## Hard constraints
- Do **NOT** modify repo files.
- Do **NOT** output code patches/diffs.
- Do **NOT** “fix forward” by changing selectors mid-run; if a selector fails, record what happened and what would be required to fix it.
- Use the testcase assets as the source of truth (do not invent selectors):
  - `testcase.json`
  - `locator_map.json`
  - `identity.json`

## Inputs
- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `ENV`: one of `A-logged_out`, `B-logged_in`, `C-incognito` (or whatever the testcase expects)
- `ITERATION`: integer (used only for filename)
- `GOAL`: what we’re validating (e.g. “VSN is populated on 88839 before submit”)
- Optional: `RUNSET_ID` (if you are correlating to an existing runset folder)

## Required files to load (read-only)
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/testcase.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/locator_map.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/identity.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/EXPECTED_OUTCOMES.md` (if present)

## What to do
1) Determine the correct start URL for `ENV` from `testcase.json`.
2) Execute the journey exactly as the runner would:
   - obey page transitions from `locator_map.json` (`visible_when_css`, `next_button_css`)
   - fill fields using selectors in `locator_map.json` + values in `identity.json`
   - if a page has no visible fillable fields but has a Next button, click Next and record it as `EMPTY_PAGE_NEXT`
3) If the testcase requires pre-form navigation (inventory/VDP/etc.), follow the testcase’s documented procedure and record where the flow diverges from expectation.
4) Submit and verify success using the success criteria defined in `locator_map.json` / `EXPECTED_OUTCOMES.md`.
5) If anything fails or flakes, stop and record the facts (do not “try random things”).

## Output: findings document (write to disk)
Write a markdown findings doc to:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/walkthrough_findings/WALKTHROUGH__<TESTCASE_ID>__<ENV>__iter-<ITERATION>__<YYYY-MM-DDThhmmssZ>.md`

## Findings doc structure (required headings)
1) Summary
2) Environment + setup assumptions
3) Inputs used (paths)
4) Step-by-step walkthrough
   - expected behavior (from testcase/locator map)
   - observed behavior (what actually happened)
   - selector resolution (what element matched; include role/name/testid if possible)
   - gating/wait condition (what should have been waited for)
   - evidence captured (screenshot/console/network notes if relevant)
5) Failures / flakes (if any)
   - first observable symptom
   - phase/URL at failure
   - DOM evidence: short snippet OR accessible role/name for the target element
6) Recommended changes (NO patches)
   - selector improvements (what would be more stable)
   - wait/gating improvements (element-visible, URL-contains, spinner-gone, network-idle, etc.)
   - conditional logic notes (what appears when; what’s unexpectedly hidden)
   - hidden-field notes (e.g. VSN placeholder token observed)

## Minimal output to print in chat
After writing the file, print:
- the filepath created
- PASS/FAIL for reaching success state
- the top 1–3 blockers (if any)
