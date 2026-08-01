---
name: compile-dev-bundle
description: >
  Performs multi-run payload deep analysis: compares expected payloads, actual
  sent payloads, WPForms exports, and CRM exports, then produces canonical
  reports and an {DEVELOPER_NAME} handoff bundle. Creates a NEW bundle directory each time.
  For appending to an existing bundle, use append-to-dev-bundle instead.
  Use when creating a fresh developer handoff bundle from one or more testcase runs.
---

<objective>
Loop over one or more testcase runs, capturing expected and actual payloads,
WPForms and CRM exports, and run evidence. For each run, produce a canonical
"Processed Payload / Sent to CRM" report and a deep analysis report. Then
build a complete {DEVELOPER_NAME} handoff bundle with indexes, raw artifacts, evidence,
standalone agent harness, and a developer interview template.

This always creates a NEW handoff bundle. To append runs to an existing bundle,
use the append-to-dev-bundle skill instead.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

Source prompt: frameworks/wordpress/qa/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md
</source_prompt>

<prompt_type>Playbook (orchestrator)</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs
- 09_SHARED_BLOCKS.md § B — Operating rules (REVIEW_ONLY mode)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy (replaces embedded philosophy)
- 09_SHARED_BLOCKS.md § F — Stakeholder Interview Gate (triggers when discrepancies exist)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language
- 09_SHARED_BLOCKS.md § H — Reporting Requirements Interview (run at intake)
- 09_SHARED_BLOCKS.md § I — Per-Run Intake Items A-G (run identifiers, evidence, exports, payloads, outcomes)
</shared_blocks_references>

<terminology>
Key terms used in this skill (to prevent confusion during analysis):

| Term | Definition |
|------|------------|
| **expected_payload.json** | The test artifact: a JSON file defining what the test EXPECTS to be sent to the CRM. Found at `playwright_phased_runner/testcases/{id}/expected_payload.json`. This is the test's "truth" for comparison. |
| **CRM schema** | The actual field definitions in Dynamics CRM (crd99_crmstagings table). May differ from expected_payload if the schema evolved or expected_payload is stale. |
| **Undocumented field** | A field present in the actual payload but NOT in expected_payload.json. This means the test doesn't know about it—NOT that it's absent from CRM schema. |
| **Missing field** | A field in expected_payload.json that is ABSENT from the actual sent payload. The test expected it, but it wasn't sent. |
| **Extra field** | Synonym for "undocumented field" — present in actual, not in expected. |
| **Value mismatch** | Field exists in both expected and actual, but values differ (beyond known deltas like email/token). |
| **Known delta** | Expected differences between envs (email addresses, test tokens, timestamps). Not anomalies. |
| **dynamics_mappings** | The WPForms-to-CRM field mapping configuration in the form's PHP handler. |
</terminology>

<quick_start>
1. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md and 09_SHARED_BLOCKS.md §§ E, F, H, I
2. [USER] Confirm testcase_id and run_id(s) to analyze. Ask: "Analyzing these runs. Correct?" **STOP and wait for user response before proceeding.**
3. [USER] Collect all data artifacts per § I intake loop (payloads, CSVs, evidence, expected outcomes). **STOP and wait for user response before proceeding.**
4. [AUTO] Changelog lookup — check for existing changelog, do NOT prompt for content
5. [AUTO] Generate canonical payload reports and deep analysis per run
6. [AUTO] Build pre-gate question inventory with evidence paths
7. [GATE: TOTAL_QUESTIONS > 0] Present questions in chat with answer slots. **STOP and wait for user response before proceeding.**
8. [AUTO] Build {DEVELOPER_NAME} handoff bundle (indexes, reports, raw, evidence, agent harness)
9. [AUTO] Finalize — verify all evidence paths, print bundle path and summary
Key deliverable: {DEVELOPER_NAME} handoff bundle with canonical payload reports and developer questions.
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
  <rule id="gate-write-block">When a GATE step triggers (condition TRUE), you MUST NOT write any files containing the gate's subject matter until the gate resolves. For the Stakeholder Gate: no bundle creation, no QUESTIONS_FOR_DEVELOPER.md until user responds or explicitly invokes fallback.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand the current state:
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/` -- see available testcases
- `ls <PROJECT_ROOT>/playwright_phased_runner/dev_handoff/` -- check for existing bundles
- `ls <PROJECT_ROOT>/playwright_phased_runner/reports/` -- check for existing payload reports
- Read `frameworks/wordpress/qa/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md` for full procedure
- Read `frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md` §§ E, F, H, I for shared blocks
</context>

<inputs>
  <required>
    <input name="testcase_id">Testcase identifier (e.g. full_mapping_t2_happypath)</input>
    <input name="run_id">Run identifier (e.g. run_0005)</input>
    <input name="runset_dir">Path to runset directory with all env folders</input>
    <input name="wpforms_csv">Path to WPForms entries export CSV</input>
    <input name="crm_csv">Path to CRM export CSV</input>
    <input name="expected_payload">JSON array/object of expected payload samples OR filepath</input>
    <input name="actual_payload_env_a">Env A "processed payload / sent to CRM" JSON or filepath</input>
    <input name="expected_outcomes">Path to EXPECTED_OUTCOMES.md or pasted spec</input>
  </required>
  <optional>
    <input name="project_root">Path to project root containing playwright_phased_runner/. If not provided, infer from runset_dir and confirm with the user before writing canonical reports.</input>
    <input name="dev_changelog_file">Path to an existing dev changelog file (skips Prompt 16 collection)</input>
    <input name="expected_payload_variants">Per-env expected payload variants (expected_payload__B.json, etc.)</input>
  </optional>
</inputs>

<outputs>
Per run:
- <PROJECT_ROOT>/playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__<testcase_id>__<run_id>__A__<createdon>__for_{developer_name}.md

Canonical changelog (if collected/provided):
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/LATEST.txt (updated)

Stakeholder answers (if gate triggered):
- {bundle_path}/raw/stakeholder_answers.md

Bundle (new):
- <PROJECT_ROOT>/playwright_phased_runner/dev_handoff/DEV_HANDOFF__{developer_name}__payload_reporting__<timestamp>/
  - llm/LLM_MANIFEST.json — machine-first manifest
  - llm/AGENTS.md, llm/CLAUDE.md, llm/.cursorrules — standalone agent harness
  - llm/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md, llm/prompts/13_...md — prompt copies
  - AGENTS.md, CLAUDE.md, .cursorrules, LLM_MANIFEST.json — bundle-root copies
  - INDEX.md, INDEX.json — artifact indexes
  - For_Recipient.md — lean observational summary
  - QUESTIONS_FOR_DEVELOPER.md — structured developer interview
  - reports/ — canonical payload reports + deep analysis reports
  - raw/ — verbatim inputs (payloads, exports, changelog, derived key lists, stakeholder_answers.md)
  - evidence/ — full runset evidence copies
</outputs>

<delegation_plan>
Per 09_SHARED_BLOCKS.md § G: If subagents are available, delegate in parallel;
otherwise run sequentially.

Per run item:

| Sub-task | Subagent Role | Inputs | Outputs |
|----------|---------------|--------|---------|
| WPForms export scan | Exports/Payload Compare | WPForms CSV, per-env emails from run.meta.json | Matched rows, date_submitted, consent fields per env |
| CRM export scan | Exports/Payload Compare | CRM CSV, per-env emails from run.meta.json | CRM row existence per env, createdon, consent fields |
| Evidence scan | Evidence Scan | Runset evidence folders | Pass/fail status per env, key artifacts |
| Manager (you) | — | Sub-task outputs + expected/actual payload | Canonical report, deep analysis, bundle assembly |
</delegation_plan>

<automated_workflow>
<step number="1" name="Confirm runs" type="USER">
1. Ask user to confirm the testcase_id and run_id(s) they want to analyze.
   - Example: "Analyzing: full_mapping_t2_happypath/run_0012. Correct?"
2. If user provides multiple runs upfront, confirm the full list.
3. Record: testcase_id, run_id, runset_dir path for each confirmed run.

**STOP and wait for user response before proceeding.**
</step>

<step number="2" name="Additional runs" type="USER">
1. Ask: "Any additional playwright_phased_runner/testcases/runs to include in this bundle?"
2. If yes: collect testcase_id and run_id for each additional run.
3. Repeat until user says "no" or "done".
4. Display final list of all runs to be analyzed.

**STOP and wait for user response before proceeding.**
</step>

<step number="3" name="Collect artifacts" type="USER">
Once all runs are confirmed, collect all data artifacts:

A) **Expected payloads** (per testcase):
   - Ask for expected_payload.json path for each unique testcase
   - Or accept a single expected payload if all runs share the same testcase

B) **Actual payloads** (per run):
   - For each run, ask for the Env A "sent to CRM" payload JSON
   - Path pattern: {testcase}/runs/{run_id}/A-logged_out/derived/sent_payload.json

C) **CRM CSV** (one file):
   - Ask for a single CRM export CSV covering all runs
   - This should contain CRM records for all test emails across all runs

D) **WPForms CSVs** (may be multiple):
   - Ask: "How many WPForms export files? (One per form ID if multiple forms involved)"
   - Collect path for each WPForms CSV
   - Note which form ID each CSV covers

E) **Evidence directories**:
   - Confirm runset_dir path for each run (contains A/B/C env folders)

F) **Expected outcomes**:
   - Ask for EXPECTED_OUTCOMES.md path per testcase (or confirm default location)

Confirm all paths. Ask: "Proceed with analysis?"

**STOP and wait for user response before proceeding.**
</step>

<step number="4" name="Changelog lookup" type="AUTO">
[AUTO] Check for existing changelog — do NOT prompt for content.

1. Check `playwright_phased_runner/changelogs/LATEST.txt`
   - If exists: read the referenced changelog file path
   - Validate the referenced file exists

2. Record changelog_status:
   - PRESENT: Changelog file found and valid → include in bundle at `raw/dev_changelog.md`
   - ABSENT: No LATEST.txt or referenced file missing → note in For_Recipient.md

3. **Do NOT prompt user for changelog content here.**
   - Changelog creation is the responsibility of `/framework:changelog-capture` (run during parallel-run post-fix)
   - This skill only LOOKS UP existing changelogs, never creates them

4. If changelog is ABSENT, add to For_Recipient.md:
   ```
   **Changelog Status:** Not available at bundle creation time.
   If fixes were made, run `/framework:changelog-capture` to document changes.
   ```

Proceed to Step 5.
</step>

<step number="5" name="Canonical payload report (per run)" type="AUTO">
Create: playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__{testcase_id}__{run_id}__A__{createdon_utc}__for_{developer_name}.md

Sections:
1. Run identity (infer from actual payload)
2. Payload (raw JSON) — exact JSON, no edits
3. Key fields (human readable) — grouped by category
4. Notes / anomalies — encoding, date formats, phone normalization, type mismatches
</step>

<step number="5a" name="Cross-form field mapping check" type="GATE" condition="multiple WPForms IDs involved">
[GATE: Multiple WPForms IDs are involved across runs]

If the runs span multiple WPForms IDs (different forms):

1. **Extract dynamics_mappings per form:**
   - For each unique WPForms ID, identify the field mappings used
   - Look for mapping config in evidence or testcase metadata

2. **Compare mappings across forms:**
   | Field | Form A (ID: xxx) | Form B (ID: yyy) | Status |
   |-------|------------------|------------------|--------|
   | first_name | field_12 → crd99_firstname | field_45 → crd99_firstname | MATCH |
   | custom_field | field_145 → crd99_createdon | NOT MAPPED | DISCREPANCY |

3. **Flag discrepancies:**
   - Fields mapped in one form but not another
   - Same WPForms field ID mapping to different CRM fields
   - Different normalization rules per form

4. **Add to question inventory for Stakeholder Gate:**
   - "Form ID xxx maps field 145 to createdon, but form ID yyy does not map this field. Is this intentional?"

If only one WPForms ID is involved, skip this step.
</step>

<step number="6" name="Deep analysis (per run)" type="AUTO">
Create analysis report covering:
A) Expected vs actual payload keys (missing, extra, value comparisons)
B) Expected outcomes vs evidence (submission, dataLayer, console, CRM/WPForms)
C) High-signal anomalies (mapping bugs, normalization, attribution, pipeline mismatches)
D) Missing-input detection (B/C envs, CRM rows, sent payloads)

All observations per 09_SHARED_BLOCKS.md § E — evidence-driven with file path citations.
</step>

<step number="6a" name="Pre-Gate Question Inventory" type="AUTO">
Before proceeding to the Stakeholder Gate, enumerate ALL questions/discrepancies discovered
and format them for direct presentation in Step 7.

**Mandatory categories to check:**
1. Value mismatches (expected vs actual payload)
2. Missing fields (in expected but not actual, or vice versa)
3. Format deltas (date formats, phone normalization, encoding differences)
4. API errors or rejections observed in evidence
5. Cross-env inconsistencies (A vs B vs C differences not explained by known deltas)
6. Expectation gaps (EXPECTED_OUTCOMES.md ambiguities or missing specs)
7. Architecture ambiguities (unclear field ownership, unknown constraints)
8. Cross-form mapping discrepancies (from Step 5a, if applicable)

Output format: <reference path="references/pre-gate-inventory-template.md" />

**Critical:** This numbered list IS the format for Step 7. Do not re-enumerate in Step 7.

If TOTAL_QUESTIONS = 0: Proceed directly to Step 8 (skip Step 7).
If TOTAL_QUESTIONS > 0: Step 7 gate is ACTIVE — present this list and wait for answers.
</step>

<step number="7" name="Stakeholder Interview Gate" type="GATE" condition="TOTAL_QUESTIONS > 0 from Step 6a">
**[GATE: TOTAL_QUESTIONS > 0]**

```
▶▶▶ STAKEHOLDER GATE ACTIVE — AWAITING USER RESPONSE ◀◀◀
```

**BYPASS PREVENTION — Why this gate exists:**
A previous execution bypassed this gate by writing questions directly to QUESTIONS_FOR_DEVELOPER.md
without presenting them to the user in chat. This defeats the purpose of the gate: to get stakeholder
clarification BEFORE finalizing the bundle. The gate MUST block file writes until resolved.

**CRITICAL CONSTRAINTS:**
- Do NOT create the bundle directory yet
- Do NOT write QUESTIONS_FOR_DEVELOPER.md yet
- Do NOT write any bundle files until this gate resolves

**Required output format (IN CHAT, not file):**

The numbered list from Step 6a is already displayed. Add answer slots:

```
══════════════════════════════════════════════════════════════
STAKEHOLDER GATE — [TOTAL_QUESTIONS] questions require clarification
══════════════════════════════════════════════════════════════

Please provide answers using the format: "1: yes, 2: intentional, 3: not sure"

1. [VALUE_MISMATCH] {crm_field_prefix}phone normalization
   → Answer: _____

2. [MISSING_FIELD] {crm_field_prefix}consent_timestamp absent
   → Answer: _____

3. [API_ERROR] attributionpath exceeds 100 chars
   → Answer: _____

[...continue for all items...]

══════════════════════════════════════════════════════════════
RESPONSE OPTIONS:
- Answer inline: "1: yes it's intentional, 2: bug, 3: skip"
- "skip" — proceed without answers (items marked UNKNOWN)
- "skip 2,4,5" — answer some, skip specific items
══════════════════════════════════════════════════════════════
```

**STOP AND WAIT FOR USER RESPONSE. DO NOT PROCEED.**

**After user responds:**
1. Parse user's answers (handle formats: "1: yes", "1=yes", "1. yes", numbered list)
2. Record to {bundle_path}/raw/stakeholder_answers.md (create bundle dir now)
3. Apply categorization:
   - User confirmed expected behavior → NOTE (not an issue)
   - User confirmed unexpected behavior → ISSUE (needs dev attention)
   - User said "don't know", "skip", or no answer → UNKNOWN (forward to dev)
4. Proceed to Step 8

**Fallback (user explicitly invokes skip):**
Only if user explicitly says "skip", "can't answer", or "proceed without":
- Create stakeholder_answers.md with all items as UNKNOWN
- Note in For_Recipient.md: "Stakeholder gate skipped — all questions marked UNKNOWN"
- Proceed to Step 8
</step>

<step number="8" name="Build {DEVELOPER_NAME} handoff bundle" type="AUTO">
Create: playwright_phased_runner/dev_handoff/DEV_HANDOFF__{developer_name}__payload_reporting__{generated_at_utc}/

Assemble (see Outputs for full list):
0. llm/LLM_MANIFEST.json with bundle_version, required_prompts, reporting_expectations, canonical_changelog_path, changelog_status, runs[]
0a. llm/ standalone agent harness (AGENTS.md, CLAUDE.md, .cursorrules, prompt copies)
0b. Bundle-root copies (AGENTS.md, CLAUDE.md, .cursorrules, LLM_MANIFEST.json)
1. INDEX.md — per-run summary with key report/file links
2. INDEX.json — stable-order artifact records
3. For_Recipient.md — lean observational summary, top "Open first" bullets
4. QUESTIONS_FOR_DEVELOPER.md — structured developer interview template
5. reports/ — canonical payload reports + deep analysis reports
6. raw/ — verbatim inputs (payloads, exports, changelog, stakeholder_answers.md)
7. evidence/ — full runset directory copies
</step>

<step number="9" name="Finalize" type="AUTO">
Ensure INDEX.md, INDEX.json, For_Recipient.md summarize ALL included runs with stable ordering.
Verify all evidence paths are valid. Print bundle path and summary.
</step>

<step number="9a" name="Unresolved Items Handoff" type="AUTO">
[AUTO] Document items that were discussed but not fully resolved.

For any item from the Stakeholder Gate where:
- User answered "don't know" or "not sure"
- User skipped the item
- Answer was ambiguous or required dev expertise

Add a dedicated section to QUESTIONS_FOR_DEVELOPER.md:

```markdown
## Items Requiring Developer Clarification

The following items were discussed with the stakeholder but could not be fully resolved
without developer context. These are forwarded for your attention.

### 1. [CATEGORY] [Brief description]

**Observation:** [What was observed]

**Stakeholder Response:** [What user said, or "Skipped"]

**Why this needs dev context:** [Why stakeholder couldn't resolve]

**Evidence:** [File paths]

---

### 2. [Next item...]
```

**Transparency note:** This step ensures nothing "falls through the cracks" between
stakeholder interview and developer handoff. Items are explicitly flagged rather than
silently included as UNKNOWN in a table.

If no unresolved items exist (all questions answered definitively), skip this section.
</step>
<step number="10" name="Validate bundle" type="AUTO">
Run output validation with an explicit report path:
  npm run workspace:output:validate -- --framework wordpress/qa --bundle {bundle_path} --report-path {bundle_path}/validation_report.json

Read {bundle_path}/validation_report.json.

If blocker findings exist:
  1. List each blocker with its code and path
  2. Attempt repair: create missing required files, fix malformed JSON
  3. Re-run validation:
     npm run workspace:output:validate -- --framework wordpress/qa --bundle {bundle_path} --report-path {bundle_path}/validation_report.json
  4. Re-read {bundle_path}/validation_report.json
  5. If blockers remain after repair, report them clearly and do NOT declare completion

If only warnings or info findings remain:
  - List warnings for awareness
  - Proceed to completion

The skill is NOT complete until validation reports zero blockers.
</step>
</automated_workflow>

<execution_mode>
REVIEW_ONLY -- no test runs are executed, no code is modified.
Raw artifacts are copied into the bundle verbatim, never altered.
</execution_mode>

<observational_examples>
<reference path="references/observational-examples.md" />
</observational_examples>

<model_recommendation>
opus -- Complex multi-run analysis task requiring subagent coordination,
multi-file synthesis, stakeholder gate execution, and structured bundle
creation. The intake loop, cross-env comparison, and evidence-driven
anomaly detection benefit from opus-level reasoning.
</model_recommendation>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Evidence directory missing or empty | Flag as BLOCKING; ask user for correct path; do not fabricate evidence |
| WPForms CSV not provided | Proceed without; note gap in report; CRM-only analysis |
| CRM CSV not provided | Proceed without; note gap; payload-only analysis |
| Expected payload not provided | Ask user — this is required for key comparison |
| Actual Env A payload not provided | BLOCKING — cannot proceed without source of truth |
| Stakeholder unavailable for gate | Use § F fallback: mark discrepancies UNKNOWN, list as questions |
| Runset has no B/C envs | Note in report; analyze A only; flag if CRM has B/C rows |
| Multiple CRM rows match single email | Pick by closest timestamp; document selection criteria |
| Changelog not available and codebase changed | Note in For_Recipient.md; bundle harness instructs dev to generate post-fix |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<success_criteria>
- All run items collected with complete inputs
- Canonical payload report written per run
- Deep analysis covers all comparison dimensions
- Changelog lookup (Step 4) executed as AUTO — no prompting for content
- If multiple WPForms IDs: cross-form mapping check (Step 5a) executed
- Pre-gate question inventory (Step 6a) output to chat with FULL numbered list and evidence paths
- If TOTAL_QUESTIONS > 0: checkpoint marker `▶▶▶ STAKEHOLDER GATE ACTIVE` was output
- If TOTAL_QUESTIONS > 0: questions presented IN CHAT with inline answer slots (→ Answer: _____)
- If TOTAL_QUESTIONS > 0: stakeholder_answers.md written only AFTER user responded (not before)
- Stakeholder gate executed when discrepancies exist
- Unresolved items (Step 9a) explicitly documented with stakeholder response and dev context note
- {DEVELOPER_NAME} handoff bundle is complete and self-contained
- No code modified; no test runs executed
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
- Output validation passes with zero blocker findings ({bundle_path}/validation_report.json exists and shows ready: true)
</success_criteria>
