# 03 — Report and Dev Handoff

> **Type**: Atomic
> **Purpose**: Analyze test run results, identify issues, and produce actionable handoff documents for developers or stakeholders.

---

## When to Use

- After completing a **runset** (A, B, C environments)
- When **issues are suspected** and need investigation
- For **periodic audits** of tracking and form behavior
- Before **deployments** to verify nothing broke

---

## Inputs (paths)

Standard inputs per `09_SHARED_BLOCKS.md` § A:
- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `RUNSET_ID`
- Completed run(s) with evidence in `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/`
- Expected outcomes: `playwright_phased_runner/testcases/<TESTCASE_ID>/EXPECTED_OUTCOMES.md`
- Optional: CRM export CSV, analytics export
- Optional: local payload JSON files (expected + actual per env)

## Outputs (paths)

- Issue report: written to runset `derived/` or provided to user
- Dev handoff document(s): per issue or per runset
- Stakeholder answers (if gate triggered): `.../<RUNSET_ID>/derived/stakeholder_answers.md`

## Guardrails

- Per `09_SHARED_BLOCKS.md` § B (Operating Rules).
- Per `09_SHARED_BLOCKS.md` § E (Observational Reporting Philosophy) — prefer observations and hypotheses over diagnoses.
- Every claim must cite an evidence path.
- Agent-platform agnostic: works with browser-capable agents or manual inspection.

---

## Overview

This prompt covers the **analysis and reporting** stage:

1. **Collect** — Gather evidence from completed runs (A, B, C environments)
2. **Analyze** — Compare actual results against expected outcomes
3. **Stakeholder Gate** — Clarify ambiguities before classifying (per `09_SHARED_BLOCKS.md` § F)
4. **Report** — Generate issue reports with severity and evidence
5. **Handoff** — Produce developer-ready documentation

---

## Evidence Locations

After a run, evidence is organized as:

```
playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/
├── A-logged_out/
│   ├── cookies/             # P0-P5 cookie snapshots (JSON)
│   ├── evidence/            # Screenshots + runtime logs (JSON/JSONL)
│   ├── derived/
│   │   ├── run.summary.json # Structured summary
│   │   └── run.summary.md   # Human-readable summary
│   ├── network/             # Network request summaries (JSONL)
│   └── run.meta.json        # Run metadata
├── B-logged_in/
│   └── ...
├── C-incognito/
│   └── ...
└── runset.meta.json         # Runset-level metadata
```

Notes:
- Folder layout can vary slightly by runner version. If a referenced artifact path doesn’t exist, search within the env directory for the filename (e.g., `find A-logged_out -name '*cookies.json'`).
- Common evidence filenames in `evidence/` include: `P1.page.png`, `P3.page.png`, `P4.page.png`, `P5.submit.page.png`, `console.events.jsonl`, `datalayer.events.jsonl`, `navigation.timeline.jsonl`, `submit.result.json`.

---

## Analysis Prompt

Provide this to an analysis agent:

```
Analyze the test run results for [TESTCASE_ID] runset [RUNSET_ID].

INPUTS:
- Run evidence: playwright_phased_runner/testcases/[TESTCASE_ID]/runs/[RUNSET_ID]/
- Expected outcomes: playwright_phased_runner/testcases/[TESTCASE_ID]/EXPECTED_OUTCOMES.md
- (Optional) CRM export: [path if available]
- (Optional) Analytics export: [path if available]

ANALYSIS TASKS:

1. RUN STATUS
   For each environment (A, B, C):
   - Did the run complete successfully?
   - If failed, at which phase? What was the error?
   - Were all fields filled correctly?

2. COOKIE ANALYSIS
   Compare cookie state across P0 → P5:
   - Are expected cookies present? (first_touch, last_touch, ga_client_id, etc.)
   - Are values populated correctly?
   - Do values persist across pages?
   - Any unexpected cookies appearing/disappearing?

3. DATALAYER ANALYSIS
   Review dataLayer.push events:
   - Are expected events firing? (pageview, form_start, form_submit, etc.)
   - Are event payloads correct?
   - Any JavaScript errors preventing events?
   - Compare A vs C (decorated URL should have UTM params in events)

4. CONSOLE ERROR ANALYSIS
   Review console messages:
   - Any JavaScript errors?
   - Any failed network requests?
   - Correlation between errors and missing functionality?

5. SUBMISSION VERIFICATION
   - Did form submission succeed? (check success indicator)
   - Was confirmation page reached?
   - (Preferred, if available) Validate the backend payload using local JSON payload files:
     - `playwright_phased_runner/testcases/[TESTCASE_ID]/expected_payload.json` (expected/schema)
     - `playwright_phased_runner/testcases/[TESTCASE_ID]/expected_payload__A.json|__B.json|__C.json` (optional env-specific expected variants)
     - `playwright_phased_runner/testcases/[TESTCASE_ID]/actual_payload.json` (actual, extracted)
     - `playwright_phased_runner/testcases/[TESTCASE_ID]/actual_payload__A.json|__B.json|__C.json` (optional env-specific actual variants)
     - (Optional) Sent-to-CRM payload captures (recommended, per runset):
       - `playwright_phased_runner/testcases/[TESTCASE_ID]/runs/[RUNSET_ID]/exports/sent_payload/sent_payload__A.json` (and __B/__C)
     - If payload schema differs (nested vs flattened), normalize before comparing and document the normalization.
   - (Optional) If a CRM export is available, use it as a cross-check (not required if payload JSON files are authoritative):
     - Did lead appear in CRM?
     - Are field values correct in CRM?

6. CROSS-ENVIRONMENT COMPARISON
   - A vs B: Does logged-in state affect behavior as expected?
   - A vs C: Does decorated URL tracking work?
   - Any environment showing issues the others don't?

OUTPUT:
Generate a findings report with:
- PASS items (working as expected)
- ISSUES found (categorized by severity)
- ROOT CAUSE analysis where determinable
- RECOMMENDED ACTIONS (prioritized)

Use severity levels:
- CRITICAL: Blocking submission or data loss
- HIGH: Tracking broken, significant data quality issues
- MEDIUM: Partial functionality affected
- LOW: Minor inconsistencies, cosmetic issues
```

---

## Issue Report Template

```markdown
# Test Run Analysis — [TESTCASE_ID] / [RUNSET_ID]

**Date**: [DATE]
**Environments**: A (logged_out), B (logged_in), C (decorated)
**Overall Status**: [PASS / ISSUES FOUND]

---

## Summary

| Env | Run Status | Form Submit | Tracking | Issues |
|-----|------------|-------------|----------|--------|
| A   | ✓ Complete | ✓ Success   | ⚠ Partial | 2 |
| B   | ✓ Complete | ✓ Success   | ✓ Working | 0 |
| C   | ✓ Complete | ✓ Success   | ✗ Broken  | 3 |

---

## Issues Found

### CRITICAL #1: [Title]

**Environment(s)**: A, C
**Phase**: P4 (post-submit)
**Symptom**: [What was observed]
**Expected**: [What should have happened]
**Evidence**:
- Screenshot: `evidence/P4.page.png`
- Console: `evidence/console.events.jsonl` (filter by phase or timestamp)
- Cookie: `cookies/P4.cookies.json` missing `first_touch`

**Root Cause**: [If determinable]
**Recommended Action**: [Specific fix]

---

### HIGH #2: [Title]

...

---

## Items Working Correctly

- ✓ Form fills all fields without errors (A, B, C)
- ✓ Page transitions complete successfully (A, B, C)
- ✓ Confirmation page displays (A, B, C)
- ✓ ga_client_id cookie present (A, B, C)

---

## Recommendations

1. **[Priority 1]**: [Action] — addresses CRITICAL #1
2. **[Priority 2]**: [Action] — addresses HIGH #2
3. **[Priority 3]**: [Action] — addresses MEDIUM issues

---

## Evidence Index

| Artifact | Path |
|----------|------|
| A Summary | `A-logged_out/derived/run.summary.md` |
| A Cookies | `A-logged_out/cookies/` |
| A dataLayer | `A-logged_out/evidence/datalayer.events.jsonl` |
| A Console | `A-logged_out/evidence/console.events.jsonl` |
| A Network | `A-logged_out/network/network.summary.jsonl` |
| B Summary | `B-logged_in/derived/run.summary.md` |
| ... | ... |
```

---

## Dev Handoff Template

For handing off to developers:

```markdown
# Developer Handoff — [ISSUE TITLE]

**Ticket**: [Link if applicable]
**Priority**: [CRITICAL/HIGH/MEDIUM/LOW]
**Reported**: [DATE]
**Reporter**: [Automated test / QA name]

---

## Issue Summary

[One paragraph describing the issue]

---

## Reproduction Steps

1. Navigate to [URL]
2. [Step by step to reproduce]
3. Expected: [What should happen]
4. Actual: [What happens instead]

---

## Technical Details

**Affected Component**: [Form ID, tracking script, integration, etc.]
**Environments**: [Which envs show the issue]
**Browser**: Chromium (Playwright)

### Evidence

**Console Error**:
```
[Paste relevant console output]
```

**Network Request**:
```
[Relevant failed request if applicable]
```

**Cookie State**:
```json
[Relevant cookie data]
```

---

## Suggested Investigation

1. Check [specific code/config]
2. Verify [integration/endpoint]
3. Test with [specific condition]

---

## Test Artifacts

| Artifact | Location |
|----------|----------|
| Full run evidence | `playwright_phased_runner/testcases/[ID]/runs/[RUNSET]/` |
| Screenshot at failure | `[path]` |
| Console log | `[path]` |
| dataLayer events | `[path]` |

---

## Verification

After fix is deployed, run:
```bash
node framework/runner/cli.js run --testcase [TESTCASE_ID] --env [ENV] --runset [RUNSET_ID]
```

Issue resolved when:
- [ ] [Specific success criterion 1]
- [ ] [Specific success criterion 2]
```

---

## Runset Comparison

For comparing multiple runsets over time:

```markdown
# Runset Comparison — [TESTCASE_ID]

**Runsets**: run_0001, run_0002, run_0003
**Date Range**: [START] to [END]

---

## Trend Analysis

| Runset | Date | A Status | B Status | C Status | Issues |
|--------|------|----------|----------|----------|--------|
| run_0001 | Jan 20 | ✓ | ✓ | ✓ | 0 |
| run_0002 | Jan 22 | ✓ | ✓ | ⚠ | 1 |
| run_0003 | Jan 24 | ✓ | ✓ | ✗ | 3 |

---

## Regression Detected

Issue first appeared in **run_0002** (Jan 22):
- [Description of what changed]

Worsened in **run_0003** (Jan 24):
- [Description of degradation]

---

## Timeline Correlation

| Date | Event | Impact |
|------|-------|--------|
| Jan 21 | [Deployment/change] | Possible cause |
| Jan 23 | [Deployment/change] | Possible cause |

---

## Recommended Actions

1. Investigate changes deployed between run_0001 and run_0002
2. Roll back or fix [specific component]
3. Re-run validation after fix
```

---

## Automation Commands

### Generate Run Summary

```bash
# After completing A, B, C runs
node framework/runner/cli.js report --testcase <testcase_id> --runset run_NNNN
```

### Export Evidence Package

```bash
# Create handoff package (evidence + summary)
node framework/runner/cli.js handoff --testcase <testcase_id> --runset run_NNNN --output ./HANDOFF_FOR_DEV/
```

---

## Stakeholder Interview Gate

Per `09_SHARED_BLOCKS.md` § F: After analysis tasks 1–6 above, if discrepancies exist between expected and actual behavior, **pause before classifying severity** and present findings to the stakeholder.

- Present all mismatches, missing data, cross-env deltas
- Ask clarifying questions (e.g., "Is this expected behavior?")
- Record answers to `.../<RUNSET_ID>/derived/stakeholder_answers.md`
- Apply: expected → NOTE, unexpected → ISSUE with severity, unavailable → UNKNOWN
- If stakeholder unavailable, use fallback per § F

---

## Acceptance Criteria

- [ ] All environments (A, B, C) analyzed
- [ ] Run summaries generated
- [ ] Stakeholder Interview Gate completed when discrepancies found (or fallback applied)
- [ ] Issues categorized by severity (informed by stakeholder answers)
- [ ] Evidence paths verified (files exist)
- [ ] Observations and hypotheses used (not diagnoses) per `09_SHARED_BLOCKS.md` § E
- [ ] Recommended actions are specific and actionable
- [ ] Reproduction steps verified
- [ ] Verification criteria defined

---

## Next Steps

After handoff:

1. **Track resolution** — Create ticket if using issue tracker
2. **Verify fix** — Re-run testcase after fix deployed (use `08_RERUN_VERIFY.md`)
3. **Update baseline** — If expected behavior changed, update EXPECTED_OUTCOMES.md
4. **Archive** — Keep run evidence for historical comparison
