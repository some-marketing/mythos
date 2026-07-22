---
name: cross-run-anomaly
description: >
  Builds a cross-run index of recurring anomalies and regressions across many
  runsets, with stable classification buckets and evidence pointers. Used to
  identify trends, regression windows, and systemic issues across the test suite.
---

<objective>
Generate a deterministic runset index and then classify anomalies into stable
buckets across all indexed runsets. Produces scannable anomaly reports with
evidence pointers and regression window estimates. This is a REVIEW_ONLY
workflow -- no runs are executed, no code is changed.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

Source prompt: frameworks/wordpress/qa/prompts/11_CROSS_RUN_ANOMALY_INDEX.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/11_CROSS_RUN_ANOMALY_INDEX.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT)
- 09_SHARED_BLOCKS.md § B — Operating rules (REVIEW_ONLY mode, evidence labeling)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy
</shared_blocks_references>

<quick_start>
1. [USER] Collect inputs: PROJECT_ROOT, optional TAG_FILTER and EXPECTED_ENVS. **STOP and wait for user response before proceeding.**
2. [AUTO] Read the source prompt file for full procedural detail.
3. [AUTO] Run the deterministic index-runsets CLI tool.
4. [AUTO] Read the generated index and per-runset evidence files.
5. [AUTO] Build anomaly buckets with stable classification.
6. [AUTO] Write anomalies.index.json and anomalies.index.md.
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
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/` -- see available testcases
- `ls <PROJECT_ROOT>/reports/` -- check for existing indexes
- Read `frameworks/wordpress/qa/prompts/11_CROSS_RUN_ANOMALY_INDEX.md` for full procedure
</context>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to the project root (usually playwright_phased_runner)</input>
  </required>
  <optional>
    <input name="TAG_FILTER">Filter runsets by tag (e.g. smoke, release-2026-01-27)</input>
    <input name="EXPECTED_ENVS">Comma-separated env list (default A,B,C)</input>
  </optional>
</inputs>

<automated_workflow>
<step number="1" type="USER" name="Collect inputs">
Ask the user for required inputs:
- PROJECT_ROOT (path to playwright_phased_runner or equivalent)
- TAG_FILTER (optional, e.g., "smoke", "release-2026-01-27")
- EXPECTED_ENVS (optional, default "A,B,C")

**STOP and wait for user response before proceeding.** Do not proceed until inputs are provided.
</step>

<step number="2" type="AUTO" name="Read source prompt">
Read the full source prompt at frameworks/wordpress/qa/prompts/11_CROSS_RUN_ANOMALY_INDEX.md
to ensure all procedural steps are followed exactly.
</step>

<step number="3" type="AUTO" name="Generate deterministic runset index">
From PROJECT_ROOT, run:
  node runner/tools/index-runsets.js \
    --testcases_dir testcases \
    --out_dir ../reports \
    --expected_envs "<EXPECTED_ENVS>" \
    --tag "<TAG_FILTER>"

This produces:
  - reports/runsets.index.json
  - reports/runsets.index.md
</step>

<step number="4" type="AUTO" name="Read index and per-runset evidence">
Read reports/runsets.index.json. For each referenced runset/env, read:
  - <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/derived/run.summary.json
  - <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/evidence/run.error.json (if present)
  - <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.manager_report.md (if present)
</step>

<step number="5" type="AUTO" name="Build anomaly buckets">
Classify anomalies into stable buckets:
  - PREFLIGHT_FAIL (auth/storage/setup)
  - selector_drift
  - validation_blocked_next
  - popup_or_overlay_blocking
  - conditional_page_mismatch
  - timing_wait_timeout
  - success_detection_false_negative
  - backend_missing_entry (requires exports)
  - backend_mapping_mismatch (requires exports)

For each bucket, document:
  - Affected testcase_id/runset_id/env combinations
  - One-sentence symptom description
  - 3-6 key evidence paths
  - First-seen runset and suspected regression window
</step>

<step number="6" type="AUTO" name="Write anomaly index files">
Write both:
  - reports/anomalies.index.json (structured, stable-order)
  - reports/anomalies.index.md (scannable, human-readable)

Keep scannable: prefer evidence paths over pasted logs.
Do not embed exports containing PII; cite filenames only.
</step>
</automated_workflow>

<outputs>
- reports/runsets.index.json -- deterministic runset index
- reports/runsets.index.md -- human-readable runset index
- reports/anomalies.index.json -- structured anomaly classification
- reports/anomalies.index.md -- scannable anomaly report
</outputs>

<execution_mode>
REVIEW_ONLY -- no test runs are executed, no code is modified.
Only reads existing run data and writes index/analysis reports.
</execution_mode>

<model_recommendation>
sonnet -- This is a pattern recognition and classification task. Sonnet handles
structured categorization and evidence cross-referencing efficiently. The stable
bucket system and evidence-pointer format keep the task well-scoped.
</model_recommendation>

<evidence_labeling>
Per 09_SHARED_BLOCKS Operating Rules: label uncertainty in all reports.
- **FACT**: backed by an evidence path (file path to artifact)
- **HYPOTHESIS**: inferred from evidence but not directly proven
- **UNKNOWN**: insufficient evidence to classify

Apply these labels inline in anomaly bucket descriptions. When classifying an anomaly,
indicate whether the classification is FACT (direct evidence), HYPOTHESIS (pattern-based),
or UNKNOWN (insufficient data). This is critical for cross-run analysis where patterns
may be correlations rather than confirmed regressions.
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
| PROJECT_ROOT missing or invalid | Flag as BLOCKING; ask user for correct path |
| index-runsets CLI tool fails | Report error; cannot proceed without index |
| No runsets found | Produce empty index with note; nothing to classify |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<success_criteria>
- index-runsets CLI tool executed successfully
- runsets.index.json and runsets.index.md generated
- All referenced runset evidence files read (summaries, errors, manager reports)
- Anomalies classified into stable buckets with evidence paths
- Anomaly classifications labeled FACT/HYPOTHESIS/UNKNOWN per 09_SHARED_BLOCKS
- anomalies.index.json and anomalies.index.md written
- No PII embedded in outputs; filenames cited instead
- Reports are scannable and prioritize evidence paths over raw logs
- No code was modified; no test runs were executed
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
</success_criteria>
