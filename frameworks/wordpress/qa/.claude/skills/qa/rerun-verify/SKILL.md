---
name: rerun-verify
description: >
  Re-runs previously failing testcase environments after fixes have been applied,
  producing a verification report with evidence pointers. Operates in RUN_ONLY
  mode with no fixes permitted. Always allocates a fresh runset to preserve
  evidence integrity. Use after implement-fixes to confirm that changes resolved
  the failures.
---

<objective>
Re-run only the previously failing environments in a fresh runset, compile
summaries, and produce a short verification report that links the rerun results
back to the reference (failed) runset.

Source of truth: frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (RUN_ONLY mode, evidence labeling)
</shared_blocks_references>

<execution_mode>
RUN_ONLY — No fixes permitted. Execute runs and produce verification report.
SAFETY RULE: Never reuse the old runset folder. Always allocate a fresh runset
tagged as a rerun of the reference.
</execution_mode>

<model_recommendation>
sonnet — Straightforward execution of CLI commands and report generation.
Does not require browser interaction or complex judgment calls.
</model_recommendation>

<quick_start>
1. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md
2. [USER] Collect inputs: PROJECT_ROOT, TESTCASE_ID, REFERENCE_RUNSET_ID, ENVS_TO_RERUN. **STOP and wait for user response before proceeding.**
3. [AUTO] Allocate a fresh runset with rerun tags
4. [AUTO] Run each env in ENVS_TO_RERUN
5. [AUTO] Compile summaries
6. [AUTO] Write rerun.verify.md
7. [USER] Print RERUN_RUNSET_ID, PASS/FAIL per env, paths created. **STOP and wait for user response before proceeding.**
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Read this file before executing:
- frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md (full procedure)
</context>

<automated_workflow>
  <step id="1" name="load-source-prompt" type="AUTO">
    [AUTO] Read the full source prompt file:
    frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md
    Follow its safety rule: never reuse the old runset folder.
  </step>

  <step id="2" name="gather-inputs" type="USER">
    [USER] Confirm all required inputs:
    - PROJECT_ROOT, TESTCASE_ID, REFERENCE_RUNSET_ID, ENVS_TO_RERUN
    Set TAGS to include: rerun,rerun_of_<REFERENCE_RUNSET_ID> (plus any user-provided tags).

    **STOP and wait for user response before proceeding.**
  </step>

  <step id="3" name="allocate-runset" type="AUTO">
    [AUTO] Run:
    ```
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js new-runset \
      --project-root "<PROJECT_ROOT>" \
      --testcase "<TESTCASE_ID>" \
      --tags "<TAGS>"
    ```
    Record the RERUN_RUNSET_ID from output.
  </step>

  <step id="4" name="run-each-env" type="AUTO">
    [AUTO] For each env in ENVS_TO_RERUN, run:
    ```
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js run \
      --project-root "<PROJECT_ROOT>" \
      --testcase "<TESTCASE_ID>" \
      --runset "<RERUN_RUNSET_ID>" \
      --env "<ENV>"
    ```
  </step>

  <step id="5" name="compile-summaries" type="AUTO">
    [AUTO] Run:
    ```
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js report \
      --project-root "<PROJECT_ROOT>" \
      --testcase "<TESTCASE_ID>" \
      --runset "<RERUN_RUNSET_ID>"
    ```
  </step>

  <step id="6" name="write-verification-report" type="AUTO">
    [AUTO] Write to:
    `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RERUN_RUNSET_ID>/derived/rerun.verify.md`

    Include:
    - Reference runset ID
    - Rerun runset ID
    - Env results table (env | status | top evidence path)
    - Top evidence paths per env
  </step>

  <step id="7" name="report-in-chat" type="USER">
    [USER] Print:
    - RERUN_RUNSET_ID=<value>
    - PASS/FAIL per env
    - Paths created:
      - .../derived/runset.summary.md
      - .../derived/runset.manager_report.md (if manager prompt was used)
      - .../derived/rerun.verify.md

    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to project containing playwright_phased_runner/testcases/</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="REFERENCE_RUNSET_ID">The runset that failed (evidence source, not to be reused)</input>
    <input name="ENVS_TO_RERUN">Comma-separated envs (e.g. A-logged_out or A-logged_out,B-logged_in)</input>
  </required>
  <optional>
    <input name="TAGS">Additional comma-separated tags (rerun tags are auto-added)</input>
  </optional>
</inputs>

<outputs>
  <output name="rerun-artifacts">
    Per-environment run artifacts under <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RERUN_RUNSET_ID>/
  </output>
  <output name="verification-report">
    `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RERUN_RUNSET_ID>/derived/rerun.verify.md`
  </output>
  <output name="runset-summary">
    `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RERUN_RUNSET_ID>/derived/runset.summary.md`
  </output>
  <output name="chat-summary">
    RERUN_RUNSET_ID, PASS/FAIL per env, paths created
  </output>
</outputs>

<evidence_labeling>
Per 09_SHARED_BLOCKS Operating Rules: label uncertainty in all reports.
- **FACT**: backed by an evidence path (file path to artifact)
- **HYPOTHESIS**: inferred from evidence but not directly proven
- **UNKNOWN**: insufficient evidence to classify

Apply these labels inline in rerun.verify.md when describing env results and evidence.
</evidence_labeling>

<success_criteria>
- A fresh runset was allocated (old runset NOT reused)
- Rerun tags include rerun_of_<REFERENCE_RUNSET_ID>
- All envs in ENVS_TO_RERUN were executed
- Report was compiled via CLI
- rerun.verify.md exists with reference ID, rerun ID, env results table, evidence paths
- Evidence claims labeled as FACT/HYPOTHESIS/UNKNOWN per 09_SHARED_BLOCKS
- Chat output shows RERUN_RUNSET_ID, PASS/FAIL per env, and created paths
- No repo files were modified (RUN_ONLY enforced)
</success_criteria>
