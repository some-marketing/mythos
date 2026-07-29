---
name: append-to-dev-bundle
description: >
  Appends one or more testcase runs to an existing payload-reporting developer
  handoff bundle, updating bundle indexes (INDEX.md, INDEX.json) and the
  For_{DEVELOPER_NAME}.md summary. Used when a bundle already exists and new runs need
  to be added without creating a fresh bundle.
---

<objective>
Add new testcase runs into an existing developer payload-reporting handoff bundle.
For each appended run, generate a canonical payload report and deep analysis,
copy evidence and raw artifacts into the bundle, update all bundle-level
index files, and produce a developer interview template.

This is a REVIEW_ONLY workflow -- no runs are executed, no code is changed.
Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E.

**Critical observational compliance rules:**
- Use "Observation:" or "HYPOTHESIS:" labels, never "Root Cause:" or "Diagnosis:"
- Use "Open Questions for Developer Context" instead of "Recommendations"
- Use "Evidence Locations:" instead of "Action Required:" or "Next Steps:"
- Never include code snippets, implementation suggestions, or time estimates
- Never use priority labels (P0/P1/P2) or "Confidence Level: HIGH" assertions
- All interpretations must be labeled "HYPOTHESIS:" with evidence path citations

To create a new bundle from scratch, use the compile-dev-bundle skill instead.

Source prompt: frameworks/wordpress/qa/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md
</source_prompt>

<prompt_type>Playbook (orchestrator)</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs
- 09_SHARED_BLOCKS.md § B — Operating rules (REVIEW_ONLY mode)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy (replaces embedded philosophy)
- 09_SHARED_BLOCKS.md § F — Stakeholder Interview Gate (triggers when discrepancies exist)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language
- 09_SHARED_BLOCKS.md § H — Reporting Requirements Interview (run at intake)
- 09_SHARED_BLOCKS.md § I — Per-Run Intake Items A-G
</shared_blocks_references>

<quick_start>
1. [USER] Select existing bundle directory and confirm overwrite policy. **STOP and wait for user response before proceeding.**
2. [USER] Collect per-run inputs via § I intake loop: testcase_id, run_id, runset_dir, CSVs, payloads. **STOP and wait for user response before proceeding.**
3. [AUTO] Read source prompt: frameworks/wordpress/qa/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md
4. [AUTO] Generate per-run canonical payload reports and deep analysis
5. [GATE: discrepancies found] Present questions to user in chat. **STOP and wait for user response before proceeding.**
6. [AUTO] Append artifacts, evidence, and raw inputs into existing bundle
7. [AUTO] Update bundle indexes (INDEX.md, INDEX.json, For_{DEVELOPER_NAME}.md)
8. [USER] Report bundle path, new report paths, follow-ups. **STOP and wait for user response before proceeding.**
Key deliverable: Updated DEV_HANDOFF bundle with appended runs and refreshed indexes.
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
- `ls <PROJECT_ROOT>/playwright_phased_runner/dev_handoff/` -- find existing bundle directories
- Read the existing bundle's INDEX.md to understand what runs are already included
- Read `frameworks/wordpress/qa/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md` for full procedure
- Read `frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md` §§ E, F, H, I for shared blocks
</context>

<inputs>
<required>
Bundle selection:
- bundle_dir: path to the existing DEV_HANDOFF__{developer_name}__payload_reporting__* directory

Per run item (collected via § I intake loop):
- testcase_id: testcase identifier
- run_id: run identifier
- runset_dir: path to runset directory with all env folders
- wpforms_csv: path to WPForms entries export CSV
- crm_csv: path to CRM export CSV
- expected_payload: JSON array/object of expected payload samples OR filepath
- actual_payload_env_a: Env A "processed payload / sent to CRM" JSON or filepath
- expected_outcomes: path to EXPECTED_OUTCOMES.md or pasted spec
</required>
<optional>
- project_root: path to project root containing playwright_phased_runner/. If not provided, infer from runset_dir and confirm with the user before writing canonical reports.
- overwrite: true|false (default false) -- whether to overwrite existing run folders in the bundle
- dev_changelog_file: path to an existing dev changelog file (skips Prompt 16 collection)
- Per-env expected payload variants (expected_payload__B.json, etc.)
</optional>
</inputs>

<outputs>
Per run:
- <PROJECT_ROOT>/playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__<testcase_id>__<run_id>__A__<createdon>__for_{developer_name}.md

Canonical changelog (if collected/provided):
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/LATEST.txt (updated)

Stakeholder answers (if gate triggered):
- {bundle}/raw/stakeholder_answers.md

Updated in existing bundle:
- llm/LLM_MANIFEST.json (updated with new runs, changelog fields)
- INDEX.md (appended), INDEX.json (appended)
- For_{DEVELOPER_NAME}.md (new per-run sections added)
- QUESTIONS_FOR_DEVELOPER.md (updated)
- reports/ (new reports), raw/ (new inputs, dev_changelog.md)
- evidence/{testcase_id}/{run_id}/ (full runset directories)
</outputs>

<delegation_plan>
Per 09_SHARED_BLOCKS.md § G: If subagents are available, delegate in parallel;
otherwise run sequentially.

Same delegation table as Prompt 13:

| Sub-task | Subagent Role | Inputs | Outputs |
|----------|---------------|--------|---------|
| WPForms export scan | Exports/Payload Compare | WPForms CSV, per-env emails | Matched rows per env |
| CRM export scan | Exports/Payload Compare | CRM CSV, per-env emails | CRM row existence per env |
| Evidence scan | Evidence Scan | Runset evidence folders | Pass/fail per env, key artifacts |
| Manager (you) | — | Sub-task outputs + payloads | Reports, bundle updates |
</delegation_plan>

<automated_workflow>
<step number="0" name="Bundle selection" type="USER">
1. Ask for existing bundle directory path (DEV_HANDOFF__{developer_name}__payload_reporting__*)
2. Confirm overwrite policy (default: false)
3. Verify bundle structural files:
   - llm/LLM_MANIFEST.json (create if missing)
   - llm/AGENTS.md, llm/CLAUDE.md, llm/.cursorrules (add if missing)
   - Bundle-root copies: AGENTS.md, CLAUDE.md, .cursorrules, LLM_MANIFEST.json (add if missing)
4. Read existing INDEX.md and INDEX.json to understand current bundle contents.

**STOP and wait for user response before proceeding.**
</step>

<step number="0a" name="Dev changelog intake (optional, not blocking)" type="USER">
1. Check bundle for raw/dev_changelog.md:
   - If present: "Bundle has a changelog. Has anything changed since it was created?"
   - If "no": proceed.
   - If "yes"/"unknown" or absent: continue.
2. Ask: "Do you already have a dev changelog file?"
3. If YES: validate, copy to canonical location + bundle raw/.
4. If NO: check LATEST.txt; if current, reuse. Otherwise ask if codebase changed.
   - "yes"/"unknown" → collect via Prompt 16.
   - "no" → proceed without; note in For_{DEVELOPER_NAME}.md.
5. Confirm changelog status.

**STOP and wait for user response before proceeding.**
</step>

<step number="1" name="Intake loop" type="USER">
1. Ask: "How many runs are we appending?"
2. Run Reporting Requirements Interview per 09_SHARED_BLOCKS.md § H.
3. For each run, collect Per-Run Intake Items per 09_SHARED_BLOCKS.md § I (A-G).
4. Confirm resolved paths. Ask: "Proceed?"

**STOP and wait for user response before proceeding.**
</step>

<step number="2" name="Generate per-run reports" type="AUTO">
Per run:
1. Create canonical Env A report in playwright_phased_runner/reports/ (same format as Prompt 13 Step 2).
2. Create deep analysis report for bundle reports/ (same format as Prompt 13 Step 3).
All observations per 09_SHARED_BLOCKS.md § E.
</step>

<step number="2a" name="Stakeholder Interview Gate" type="GATE" condition="any questions or discrepancies identified">
**[GATE: any questions or discrepancies identified]**

CRITICAL: If you identified ANY of the following during analysis, you MUST stop here:
- Open questions about field behavior or format
- Discrepancies between expected and actual
- Ambiguities that would go in QUESTIONS_FOR_DEVELOPER.md

**Detection rule:** If your analysis would generate content for QUESTIONS_FOR_DEVELOPER.md,
then the gate condition is TRUE and you MUST stop.

**If condition TRUE (questions exist):**
1. Present each question/discrepancy to the user IN CHAT (not just in a file)
2. Ask: "Before I continue, I need clarification on these [N] items:"
3. List each question with its evidence reference
4. **STOP AND WAIT FOR USER RESPONSE. DO NOT PROCEED.**
5. Record user's answers to {bundle}/raw/stakeholder_answers.md
6. Apply answers: expected behavior → NOTE, unexpected → ISSUE, "don't know" → UNKNOWN

**If condition FALSE (no questions):**
Proceed to step 3.

**Fallback (user explicitly unavailable):**
Only if user explicitly says "skip" or "can't answer now":
- Mark all items as UNKNOWN
- Note in For_{DEVELOPER_NAME}.md that gate was skipped
</step>

<step number="3" name="Append artifacts into bundle" type="AUTO">
A) Evidence: copy full runset folder to evidence/{testcase_id}/{run_id}/... (respect overwrite policy).
B) Raw: copy verbatim inputs to raw/ (expected payloads, actual payload, CSVs, changelog if new).
C) Reports: copy canonical payload report + deep analysis report to reports/.
</step>

<step number="4" name="Update bundle indexes" type="AUTO">
Merge new run data into existing bundle-level files:
0. llm/LLM_MANIFEST.json — update runs[], reporting_expectations, changelog fields
1. INDEX.md — add new runs with stable ordering (by testcase_id, then run_id)
2. INDEX.json — append artifact records with stable ordering
3. For_{DEVELOPER_NAME}.md — add per-run sections; top points to llm/LLM_MANIFEST.json and raw/dev_changelog.md
4. QUESTIONS_FOR_DEVELOPER.md — update with new observations and questions
</step>

<step number="5" name="Loop and finalize" type="USER">
After each run: "Add another run? If no, reply done."
Print: bundle path, new report paths, QUESTIONS path, any follow-ups.

**STOP and wait for user response before proceeding.**
</step>

<step number="6" name="Validate bundle" type="AUTO">
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
Existing bundle files are updated (merged), not overwritten from scratch.
</execution_mode>

<model_recommendation>
sonnet -- Structured append operation with well-defined inputs and outputs.
The merge logic for indexes and per-run report generation are straightforward.
The source prompt (14) mirrors prompt 13 but scoped to append operations.
</model_recommendation>

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
| Bundle path doesn't exist | Ask user for correct path; do not create new bundle (use Prompt 13) |
| Existing run folder collision (overwrite=false) | Ask user: skip, overwrite, or create new bundle |
| Evidence directory missing | Flag as BLOCKING; ask for correct path |
| Required inputs missing (Env A payload) | BLOCKING — cannot proceed |
| Optional inputs missing (WPForms/CRM CSV) | Proceed with partial analysis; note gaps |
| Stakeholder unavailable | Use § F fallback: mark UNKNOWN, do not assume |
| Bundle missing structural files | Add them (copy from repo or llm/ equivalents) |
| Report contains prescriptive content | MUST REWRITE: replace "Root Cause" → "Observation" + "HYPOTHESIS", replace "Recommendations" → "Open Questions", remove code/solutions/priorities |
</failure_modes>

<acceptance_criteria>
- Each appended run has a canonical payload report and deep analysis report
- Bundle INDEX.md and INDEX.json include all old + new runs in stable order
- For_{DEVELOPER_NAME}.md updated with per-run sections for appended runs
- QUESTIONS_FOR_DEVELOPER.md updated with new observations
- Stakeholder gate was executed if discrepancies were identified
- llm/LLM_MANIFEST.json reflects updated run list and changelog status
- Output validation passes with zero blocker findings ({bundle_path}/validation_report.json exists and shows ready: true)
</acceptance_criteria>

<success_criteria>
- Existing bundle validated and updated correctly
- All appended runs have complete reports and evidence
- Stakeholder gate executed when discrepancies exist
- All reports follow observational philosophy per § E
- Bundle indexes maintain stable ordering across old + new runs
- No code modified; no test runs executed
- **Observational compliance verified:** Zero instances of "Root Cause:", "Recommendation:", "Action Required:", code snippets, P0/P1/P2 labels, or "Confidence Level" assertions in any report
- All interpretive statements use "HYPOTHESIS:" label with evidence citations
- Output validation passes with zero blocker findings ({bundle_path}/validation_report.json exists and shows ready: true)
</success_criteria>
