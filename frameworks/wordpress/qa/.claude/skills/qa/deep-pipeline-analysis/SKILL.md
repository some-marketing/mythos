---
name: deep-pipeline-analysis
description: >
  Traces expected values through the full pipeline (identity -> WPForms -> CRM)
  and produces a field-by-field truth table with actionable synthesis report.
  Used when the UI run passes but backend data is wrong or missing, or when
  mapping contract drift is suspected.
---

<objective>
Perform a deep pipeline analysis across WPForms and CRM exports for a given
testcase runset, producing a field-by-field comparison and synthesis report.
This is a REVIEW_ONLY workflow -- no runs are executed, no code is changed.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

Source prompt: frameworks/wordpress/qa/prompts/10_DEEP_PIPELINE_ANALYSIS.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/10_DEEP_PIPELINE_ANALYSIS.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (REVIEW_ONLY mode, evidence labeling)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy
</shared_blocks_references>

<quick_start>
1. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/10_DEEP_PIPELINE_ANALYSIS.md
2. [USER] Collect inputs: PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, WPFORMS_EXPORT_CSV, CRM_EXPORT_CSV. Ask: "Confirm export CSV locations?" **STOP and wait for user response before proceeding.**
3. [AUTO] Run deterministic compare-exports CLI command
4. [AUTO] Read generated comparison outputs
5. [AUTO] Write synthesis report with executive summary and evidence chains
6. [GATE: mapping CSVs missing] Flag gaps for CRM assertions if mapping CSVs absent
7. [USER] Present synthesis report location and summary. **STOP and wait for user response before proceeding.**
Key deliverable: Deep pipeline synthesis report with field-by-field truth table.
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand the current state:
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/` -- confirm export files
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/` -- check for prior comparisons
- Read `frameworks/wordpress/qa/prompts/10_DEEP_PIPELINE_ANALYSIS.md` for full procedure
</context>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to the project root (usually playwright_phased_runner)</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="RUNSET_ID">The runset identifier</input>
    <input name="WPFORMS_EXPORT_CSV">Path to the WPForms export CSV file</input>
    <input name="CRM_EXPORT_CSV">Path to the CRM export CSV file</input>
  </required>
  <optional>
    <input name="INCLUDE_EXPORTS_IN_HANDOFF">true|false (default false) — include exports in handoff bundle</input>
  </optional>
</inputs>

<automated_workflow>
<step number="1" name="Read source prompt" type="AUTO">
[AUTO] Read the full source prompt at frameworks/wordpress/qa/prompts/10_DEEP_PIPELINE_ANALYSIS.md
to ensure all procedural steps are followed exactly.
</step>

<step number="2" name="Validate inputs and exports" type="USER">
[USER] Confirm the export CSVs are stored (or can be placed) under:
  <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/
If not present, copy them there before proceeding.

STOP. Wait for user to provide CSV paths or confirm location.
</step>

<step number="3" name="Run deterministic export comparison" type="AUTO">
[AUTO] Execute the CLI comparison command:
  cd "<PROJECT_ROOT>" && node framework/runner/cli.js compare-exports \
    --project-root "<PROJECT_ROOT>" \
    --testcase "<TESTCASE_ID>" \
    --runset "<RUNSET_ID>" \
    --wpforms "<WPFORMS_EXPORT_CSV>" \
    --crm "<CRM_EXPORT_CSV>"

This writes outputs under:
  <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/
</step>

<step number="4" name="Read comparison outputs" type="AUTO">
[AUTO] Read all generated files in the compare/ directory:
  - compare__<RUNSET_ID>__backend-export-match__*.md (email matching + picked rows)
  - compare__<RUNSET_ID>__mapping-contract__*.md (if mapping CSVs exist)
  - compare__<RUNSET_ID>__expected-outcomes__*.md (if EXPECTED_OUTCOMES.md + locator_map.json present)
</step>

<step number="5" name="Write synthesis report" type="AUTO">
[AUTO] Create the analysis report at:
  <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/deep_analysis__<RUNSET_ID>__<timestamp>.md

Include:
  - Executive summary: PASS / ISSUES_FOUND / FAIL
  - Per env row matched (A/B/C): counts of matched/mismatched/skipped
  - Top issues (grouped by category): mapping missing vs value mismatch vs empty CRM fields
  - Per issue: evidence chain (paths), HYPOTHESIS (with evidence citations), open questions for developer
</step>

<step number="6" name="Optional handoff bundle" type="GATE">
[GATE: INCLUDE_EXPORTS_IN_HANDOFF is true] If true, run:
  cd "<PROJECT_ROOT>" && node framework/runner/cli.js handoff \
    --project-root "<PROJECT_ROOT>" \
    --testcase "<TESTCASE_ID>" \
    --runset "<RUNSET_ID>" \
    --include-exports

If false, skip and proceed.
</step>

<step number="7" name="Flag gaps" type="USER">
[USER] If mapping CSVs are missing (fields_mapped_to_crm.csv, system_fields_mapped_to_crm.csv),
call that out as a blocking gap for CRM assertions. Do not claim tracking works
without proof in exports or explicit automation proof artifacts.

STOP. Present synthesis report location and summary to user.
</step>
</automated_workflow>

<outputs>
- Synthesis report: <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/deep_analysis__<RUNSET_ID>__<timestamp>.md
- CLI-generated comparison files in the compare/ directory
- Optional: handoff bundle (if INCLUDE_EXPORTS_IN_HANDOFF=true)
</outputs>

<execution_mode>
REVIEW_ONLY -- no test runs are executed, no code is modified.
Only reads existing data and writes analysis reports.
</execution_mode>

<model_recommendation>
sonnet -- This is an analytical, data-comparison task. Sonnet handles structured
field-by-field comparisons and evidence synthesis efficiently without requiring
the deeper reasoning of opus.
</model_recommendation>

<evidence_labeling>
Per 09_SHARED_BLOCKS Operating Rules: label uncertainty in all reports.
- **FACT**: backed by an evidence path (file path to artifact)
- **HYPOTHESIS**: inferred from evidence but not directly proven
- **UNKNOWN**: insufficient evidence to classify

Apply these labels inline in the synthesis report when describing issues and
evidence chains. This is especially important for pipeline analysis where some
conclusions are inferred from data patterns rather than directly observed.
</evidence_labeling>

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
| PROJECT_ROOT, TESTCASE_ID, or RUNSET_ID missing | Flag as BLOCKING; ask user for missing values |
| Export CSVs not provided | Flag as BLOCKING; cannot proceed without both WPForms and CRM exports |
| compare-exports CLI fails | Report error; attempt manual comparison if possible |
| Mapping CSVs missing | Proceed without; flag as gap in CRM assertions |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<success_criteria>
- All required inputs were collected and validated
- CLI compare-exports command executed successfully
- All generated comparison outputs were read and incorporated
- Synthesis report written with executive summary, per-env breakdown, and categorized issues
- Each issue includes evidence chain paths and HYPOTHESIS labeled FACT/HYPOTHESIS/UNKNOWN
- Missing mapping CSVs flagged as blocking gaps if absent
- No code was modified; no test runs were executed
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
</success_criteria>
