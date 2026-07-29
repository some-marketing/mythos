---
name: implement-fixes
description: >
  Applies the smallest set of repo changes needed to fix failing testcase
  environments, using run artifacts and walkthrough findings as evidence.
  Operates in PATCH_ALLOWED mode with traceability from every change back
  to its evidence source. Use after triage or walkthrough has identified
  actionable root causes.
---

<objective>
Identify the root cause of each failing environment, pick the smallest fix
surface, implement changes with full traceability (change -> file -> why ->
evidence path), validate definitions, and hand off to rerun-verify for
targeted verification.

Source of truth: frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (PATCH_ALLOWED mode)
</shared_blocks_references>

<execution_mode>
PATCH_ALLOWED — Repo modifications are permitted. Scope must be minimal.
Do NOT edit files under <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/... except
writing new files under derived/. Prefer robust selectors and deterministic
waits over sleeps.
</execution_mode>

<model_recommendation>
sonnet — Targeted code changes to JSON assets and runner code. Does not
require browser interaction or complex multi-step orchestration.
</model_recommendation>

<quick_start>
1. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md and frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md (Operating Rules)
2. [USER] Collect inputs: PROJECT_ROOT, TESTCASE_ID, FAILING_ENVS, REFERENCE_RUNSET_ID, GOAL. Ask: "Proceed with fixing these failing environments?" **STOP and wait for user response before proceeding.**
3. [AUTO] Read run evidence for each failing env
4. [AUTO] Read testcase assets (testcase.json, locator_map.json, identity.json)
5. [AUTO] Identify root cause per failing env, pick smallest fix surface
6. [AUTO] Implement minimal fixes with traceability (change -> file -> why -> evidence)
7. [AUTO] Validate definitions using framework/runner/cli.js validate
8. [USER] Report files changed, change-to-evidence mapping, commands run, expected fix scope. Ask: "Proceed to rerun verification using rerun-verify skill or 08_RERUN_VERIFY.md?" **STOP and wait for user response before proceeding.**
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Read these files before executing:
- frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md (full procedure)
- frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md (Operating Rules)

Per failing env, read from `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<REFERENCE_RUNSET_ID>/<ENV>/`:
- derived/run.summary.json
- evidence/run.error.json (if present)
- evidence/console.errors.summary.md (if present)
- evidence/FAILURE.*.page.png (if present)
- evidence/submit.result.json (if present)

Also read testcase assets:
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/testcase.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/locator_map.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/identity.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/EXPECTED_OUTCOMES.md` (if present)

If walkthrough findings exist, read those too:
- Paths provided via WALKTHROUGH_FINDINGS_PATHS input
</context>

<automated_workflow>
  <step id="1" name="load-source-prompt" type="AUTO">
    [AUTO] Read the full source prompt file:
    frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md
    Also read frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md for Operating Rules.
  </step>

  <step id="2" name="gather-inputs" type="USER">
    [USER] Present collected inputs:
    - PROJECT_ROOT, TESTCASE_ID, FAILING_ENVS, REFERENCE_RUNSET_ID, GOAL
    - WALKTHROUGH_FINDINGS_PATHS (if provided)
    - EXTRA_CONTEXT (if provided)
    Ask: "Proceed with fixing these failing environments?"
    **STOP and wait for user response before proceeding.**
  </step>

  <step id="3" name="read-evidence" type="AUTO">
    [AUTO] For each env in FAILING_ENVS, read run artifacts:
    - derived/run.summary.json
    - evidence/run.error.json, console.errors.summary.md, FAILURE screenshots
    - evidence/submit.result.json
    Also read testcase assets: testcase.json, locator_map.json, identity.json.
    Read walkthrough findings if paths were provided.
  </step>

  <step id="4" name="identify-root-cause" type="AUTO">
    [AUTO] Per failing env, state root cause in one sentence.
    Prioritize the earliest shared root cause across environments.
    Report findings in chat.
  </step>

  <step id="5" name="pick-fix-surface" type="AUTO">
    [AUTO] Choose the smallest change scope:
    - Selector drift -> update locator_map.json
    - Wrong test values -> update identity.json
    - Pre-form navigation changes -> update testcase.json
    - Runner behavior bug -> update runner/run-phased.js (or wrapper/tooling)
    Report chosen fix surface in chat.
  </step>

  <step id="6" name="implement-changes" type="AUTO">
    [AUTO] Apply changes. For every change, record traceability:
    change -> file -> why -> evidence path(s)
    Report changes as they are made.
  </step>

  <step id="7" name="validate-definitions" type="AUTO">
    [AUTO] Run: `cd "<PROJECT_ROOT>" && node framework/runner/cli.js validate --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>"`
    Fix any validation errors before proceeding.
    Report validation status.
  </step>

  <step id="8" name="report-in-chat" type="USER">
    [USER] Print:
    - Files changed (paths)
    - Brief mapping of change -> evidence (paths only)
    - Exact commands ran (if any)
    - Which envs are expected to be fixed by the change
    Ask: "Proceed to rerun verification using rerun-verify skill or 08_RERUN_VERIFY.md?"
    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to project containing playwright_phased_runner/testcases/</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="FAILING_ENVS">Comma-separated list (e.g. A-logged_out,B-logged_in)</input>
    <input name="REFERENCE_RUNSET_ID">The runset whose evidence drives the fix</input>
    <input name="GOAL">Success definition for this testcase</input>
  </required>
  <optional>
    <input name="WALKTHROUGH_FINDINGS_PATHS">One or more paths to walkthrough findings docs</input>
    <input name="EXTRA_CONTEXT">Links to tickets, known site changes, etc.</input>
  </optional>
</inputs>

<outputs>
  <output name="changed-files">Modified repo files (locator_map.json, identity.json, testcase.json, runner code)</output>
  <output name="chat-report">Files changed, change-to-evidence mapping, commands run, expected fix scope</output>
</outputs>

<success_criteria>
- Root cause is stated per failing env with evidence references
- Changes are minimal (smallest fix surface selected)
- Every change has traceability: change -> file -> why -> evidence path
- Definition validation passes after changes
- No run artifact files were modified (only derived/ additions allowed)
- Chat output lists all changed files and evidence mapping
- Rerun verification is recommended as next step
</success_criteria>
