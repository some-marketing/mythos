---
name: report-handoff
description: >
  Analyzes completed test run results, compares actual behavior against expected outcomes,
  and produces severity-based issue reports and developer handoff documents. Covers cookie
  analysis, dataLayer events, console errors, submission verification, payload comparison,
  and cross-environment differences. Use after completing a runset across A/B/C environments.
---

<objective>
Analyze test run evidence from completed A/B/C environments, identify discrepancies against
expected outcomes, and produce observational reports with hypotheses for developers to use
in their own diagnosis.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

This skill wraps the detailed procedure defined in the source prompt. The executor MUST read
the source prompt file in full before proceeding.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (FINDINGS_ONLY mode)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy (observations + hypotheses, not diagnoses)
- 09_SHARED_BLOCKS.md § F — Stakeholder Interview Gate (triggers when discrepancies exist)
</shared_blocks_references>

<model_recommendation>
sonnet -- Primarily analysis and structured writing. Does not require browser interaction or
visual reasoning. Sonnet handles evidence comparison, pattern recognition across environments,
and report generation efficiently.
</model_recommendation>

<execution_mode>
FINDINGS_ONLY -- This skill reads evidence and produces reports. It does not modify testcase
configuration, fix selectors, or rerun tests. Output is reports and handoff documents only.
</execution_mode>

<quick_start>
1. [AUTO] Read the source prompt: frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md
2. [USER] Identify the testcase and runset to analyze. **STOP and wait for user response before proceeding.**
3. [AUTO] Read EXPECTED_OUTCOMES.md for the testcase.
4. [AUTO] Read run evidence from each environment (summaries, cookies, dataLayer, console, network).
5. [AUTO] Perform the six analysis tasks defined in the source prompt.
6. [GATE: discrepancies exist] If discrepancies exist: run Stakeholder Interview Gate per § F before classifying severity. **STOP and wait for user response before proceeding.**
7. [AUTO] Produce issue report with severity classification.
8. [AUTO] Generate dev handoff documents for any CRITICAL or HIGH issues.
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, verify evidence exists:
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/{testcase_id}/runs/` — list available runsets
- `ls -R <PROJECT_ROOT>/playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/` — check structure
- Read `playwright_phased_runner/testcases/{testcase_id}/EXPECTED_OUTCOMES.md` — expected outcomes
- Read `frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md` for full procedure
- Read `frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md` §§ E, F for shared blocks
</context>

<inputs>
<required>
- testcase_id: the testcase to analyze
- runset_id: the runset to analyze (e.g., run_0001)
</required>
<optional>
- project_root: path to project root containing playwright_phased_runner/testcases/. Defaults to current working directory.
- environments: which environments to analyze. Default: A-logged_out, B-logged_in, C-incognito
- crm_export_path: path to CRM export for cross-system validation
- analytics_export_path: path to analytics export for event validation
- compare_runsets: comma-separated list of additional runset IDs for trend analysis
</optional>
</inputs>

<outputs>
- Issue report with severity-classified findings (stdout or derived/ directory)
- Dev handoff document(s) for CRITICAL/HIGH issues (if any found)
- Stakeholder answers (if gate triggered): `.../<RUNSET_ID>/derived/stakeholder_answers.md`
- Runset comparison (if compare_runsets provided)
</outputs>

<automated_workflow>
<step number="1" name="Load source prompt" type="AUTO">
[AUTO] Read the full source prompt file:
  frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md

This is the authoritative reference. Pay attention to the "Analysis Prompt" section
for the six analysis tasks and the report/handoff templates.
</step>

<step number="1a" name="Identify testcase and runset" type="USER">
[USER] If testcase_id or runset_id were not provided as inputs, ask the user to specify:
- Which testcase to analyze
- Which runset to analyze (e.g., run_0001)

List available testcases and runsets if needed to help user choose.

**STOP and wait for user response before proceeding.**
</step>

<step number="2" name="Gather evidence" type="AUTO">
[AUTO]
Read evidence from each environment:

```
playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/
+-- {ENV}/
    +-- cookies/              (P0-P5 cookie snapshots)
    +-- evidence/             (screenshots, runtime logs)
    +-- derived/
    |   +-- run.summary.json  (structured summary)
    |   +-- run.summary.md    (human-readable summary)
    +-- network/              (network request summaries)
    +-- run.meta.json         (run metadata)
```

Note: folder layout may vary. If a path does not exist, search within the env
directory for the filename.

Also read:
- playwright_phased_runner/testcases/{testcase_id}/EXPECTED_OUTCOMES.md
- Payload files if they exist (expected_payload.json, actual_payload.json, env-specific variants)
- Sent-to-CRM captures if available under runs/{runset_id}/exports/sent_payload/
</step>

<step number="3" name="Perform analysis" type="AUTO">
[AUTO] Execute the six analysis tasks defined in the source prompt's "Analysis Prompt":

1. RUN STATUS -- Per-env completion, failure phase, field fill accuracy
2. COOKIE ANALYSIS -- Compare P0 to P5 cookie state, persistence, expected vs actual
3. DATALAYER ANALYSIS -- Event firing, payload correctness, JS errors, A vs C comparison
4. CONSOLE ERROR ANALYSIS -- JS errors, failed network requests, correlation with failures
5. SUBMISSION VERIFICATION -- Success indicator, confirmation page, payload comparison
   (prefer local JSON payload files over CRM export when available)
6. CROSS-ENVIRONMENT COMPARISON -- A vs B (auth impact), A vs C (tracking/decoration)
</step>

<step number="3a" name="Stakeholder Interview Gate" type="GATE" condition="discrepancies exist">
**[GATE: discrepancies exist]**

CRITICAL: If you identified ANY of the following during analysis, you MUST stop here:
- Mismatches between expected and actual behavior
- Missing data or gaps in evidence
- Cross-environment deltas that are ambiguous
- Questions about whether observed behavior is intentional

**Detection rule:** If your analysis would generate severity classifications with uncertainty,
then the gate condition is TRUE and you MUST stop.

**If condition TRUE (discrepancies exist):**
1. Present each discrepancy to the user IN CHAT (not just in files)
2. Ask: "Before I classify severity, I need clarification on these [N] items:"
3. List each discrepancy with its evidence reference
4. **STOP AND WAIT FOR USER RESPONSE. DO NOT PROCEED.**
5. Record user's answers to `.../<RUNSET_ID>/derived/stakeholder_answers.md`
6. Apply answers: expected behavior → NOTE, unexpected → ISSUE with severity, "don't know" → UNKNOWN

**If condition FALSE (no discrepancies):**
Proceed to step 4.

**Fallback (user explicitly unavailable):**
Only if user explicitly says "skip" or "can't answer now":
- Mark all items as UNKNOWN
- Note in report that stakeholder gate was skipped
- Proceed to step 4
</step>

<step number="4" name="Produce issue report" type="AUTO">
[AUTO] Generate the issue report following the "Issue Report Template" in the source prompt.

Use severity levels:
- CRITICAL: Blocking submission or data loss
- HIGH: Tracking broken, significant data quality issues
- MEDIUM: Partial functionality affected
- LOW: Minor inconsistencies, cosmetic issues

Include for each issue: environment(s), phase, symptom, expected behavior, evidence
paths, and hypothesis (labeled as HYPOTHESIS, backed by evidence citations).
Do NOT diagnose root causes or prescribe solutions — posit hypotheses and list
open questions for the developer. All observations per § E.

Also list all items working correctly (PASS items).
</step>

<step number="5" name="Produce dev handoff" type="AUTO" condition="CRITICAL or HIGH issues found">
[AUTO] For each CRITICAL or HIGH issue, generate a dev handoff document following the
"Dev Handoff Template" in the source prompt. Include:
- Issue summary, priority, reproduction steps
- Technical details (affected component, environments, browser)
- Evidence (console errors, network requests, cookie state)
- Hypotheses (labeled, with evidence citations)
- Open questions for the developer
- Test artifact locations
- Verification criteria (how to confirm expected outcomes are met)
</step>

<step number="6" name="Runset comparison" type="AUTO" condition="compare_runsets provided">
[AUTO] If comparing multiple runsets, follow the "Runset Comparison" template:
- Trend analysis table across runsets
- Regression detection (when did issues first appear?)
- Timeline correlation with deployments/changes
- Hypotheses about trend causes (labeled, with evidence)
</step>

<step number="7" name="Before-handoff checklist" type="AUTO">
[AUTO] Verify against the source prompt's acceptance criteria:
- All environments analyzed
- Run summaries reviewed
- Stakeholder Interview Gate completed when discrepancies found (or fallback applied)
- Issues categorized by severity (informed by stakeholder answers)
- Evidence paths verified (files exist)
- Observations and hypotheses used (not diagnoses) per § E
- Open questions for the developer are listed
- Reproduction steps verified
- Verification criteria defined
</step>
</automated_workflow>

<observational_examples>
**WRONG (prescriptive):**
```
**Root Cause:** The attributionpath field exceeds the 100-char limit.

**Recommendations:**
1. Truncate attributionpath to 100 chars
2. Implement compact format: "source1→source2"

**Action Required:** Immediate backend fix
**Confidence Level:** VERY HIGH
```

**CORRECT (observational):**
```
**Observation:** The `{crm_field_prefix}attributionpath` field contained 253 characters.
The CRM API returned error code 0x80044331 citing a maximum length of 100 characters.

**HYPOTHESIS:** The field length (253 chars) exceeds the CRM's 100-char limit, which
may explain the API rejection. Evidence: `raw/error_logs.txt` line 17.

**Open Questions for Developer Context:**
1. What is the intended format for attributionpath?
2. Is the 100-char limit a schema constraint or API validation?

**Evidence Locations:**
- Error logs: `raw/error_logs.txt`
- Sent payload: `raw/run_0009__sent_payload__C.json`
```
</observational_examples>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Evidence directory missing or empty | Flag as BLOCKING; ask user for correct path |
| EXPECTED_OUTCOMES.md missing | Ask user for expected outcomes; cannot classify severity without them |
| Partial environment evidence (e.g., only A completed) | Analyze available envs; note missing envs in report |
| Payload JSON files not found | Proceed with available evidence; note gap in submission verification |
| Stakeholder unavailable for gate | Use § F fallback: mark discrepancies UNKNOWN, list as questions |
| CRM/analytics export not provided | Proceed without; note gap; evidence-only analysis |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<acceptance_criteria>
- All environments (A, B, C) analyzed
- Run summaries generated
- Stakeholder Interview Gate completed when discrepancies found (or § F fallback applied)
- Issues categorized by severity (informed by stakeholder answers)
- Evidence paths verified (files exist)
- Observations and hypotheses used (not diagnoses) per § E
- CRITICAL and HIGH issues have dev handoff documents (if any found)
- PASS items listed to show what is working
- Open questions for the developer are included
- Reproduction steps verified
- Verification criteria defined

**Observational compliance (MANDATORY):**
- Zero "Root Cause:" or "Diagnosis:" labels in any report
- Zero "Recommendation:" or "Action Required:" sections
- Zero code snippets or implementation suggestions
- Zero priority labels (P0/P1/P2) or time estimates
- Zero "Confidence Level: HIGH/VERY HIGH" assertions
- All interpretations use "HYPOTHESIS:" label with evidence path citations
</acceptance_criteria>

<success_criteria>
- All available environment evidence has been read and analyzed
- Issue report produced with correct severity classification
- Every issue has evidence paths that point to real files
- Stakeholder gate executed when discrepancies exist (or § F fallback applied)
- CRITICAL and HIGH issues have dev handoff documents (if any found)
- PASS items listed to show what is working
- Hypotheses are evidence-backed and clearly labeled per § E
- Open questions for the developer are included
- User informed of next steps: track resolution, verify fix, update baseline
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
</success_criteria>
