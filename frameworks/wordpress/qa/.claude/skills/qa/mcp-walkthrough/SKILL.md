---
name: mcp-walkthrough
description: >
  Troubleshoots automation flows via live browser walkthrough using Playwright MCP,
  documenting findings without applying fixes. Operates in FINDINGS_ONLY mode to
  observe selector resolution, page transitions, wait conditions, and DOM state.
  Use when a testcase environment is failing and you need live DOM evidence before
  implementing changes.
---

<objective>
Execute a live browser walkthrough of a testcase environment exactly as the runner
would, recording observations about selectors, waits, conditionals, popups, hidden
fields, and page transitions. Produce a structured findings document. No repo
modifications are permitted.

Source of truth: frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, ENV)
- 09_SHARED_BLOCKS.md § B — Operating rules (FINDINGS_ONLY mode)
</shared_blocks_references>

<execution_mode>
FINDINGS_ONLY — No repo file modifications. No code patches. No selector changes
mid-run. Observe, record, and recommend only.
</execution_mode>

<model_recommendation>
opus — Requires live browser interaction via Playwright MCP, DOM analysis, complex
debugging of selector failures, and nuanced observation of page behavior.
</model_recommendation>

<quick_start>
1. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
2. [GATE: required inputs not provided] Collect inputs: PROJECT_ROOT, TESTCASE_ID, ENV, ITERATION, GOAL
3. [AUTO] Load testcase assets (read-only): testcase.json, locator_map.json, identity.json
4. [AUTO] Execute the journey step-by-step via Playwright MCP, recording observations
5. [AUTO] Write findings document to walkthrough_findings/ directory
6. [USER] Present walkthrough results: filepath, PASS/FAIL, top blockers, and ask for next action
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
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/testcase.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/locator_map.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/identity.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/EXPECTED_OUTCOMES.md` (if present)
</context>

<automated_workflow>
  <step id="1" name="load-source-prompt" type="AUTO">
    [AUTO] Read the full source prompt file:
    frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
    Follow its hard constraints and detailed procedures exactly.
  </step>

  <step id="2" name="gather-inputs" type="GATE">
    [GATE: required inputs not provided]

    If any of PROJECT_ROOT, TESTCASE_ID, ENV, ITERATION, or GOAL are missing, ask user:
    "Please provide the following inputs for the walkthrough:
    - PROJECT_ROOT: Path to the project root containing `playwright_phased_runner/` (e.g., `/path/to/workspace/projects/wordpress__qa__your-project`)
    - TESTCASE_ID: The testcase identifier
    - ENV: Environment (A-logged_out, B-logged_in, or C-incognito)
    - ITERATION: Integer for filename (e.g., 1)
    - GOAL: What we are validating (e.g., 'Verify VSN is populated on 88839 before submit')
    - RUNSET_ID (optional): For correlating to an existing runset"

    **STOP and wait for user response before proceeding.**

    Once all required inputs are available, confirm them and proceed.
    If RUNSET_ID is provided, note it for correlation.
  </step>

  <step id="3" name="load-testcase-assets" type="AUTO">
    [AUTO] Read testcase.json, locator_map.json, identity.json (read-only).
    Read EXPECTED_OUTCOMES.md if present.
    Determine the start URL for the given ENV from testcase.json.
  </step>

  <step id="4" name="execute-walkthrough" type="AUTO">
    [AUTO] Using Playwright MCP browser tools, execute the journey exactly as the runner would.
    Follow the "What to do" procedure from the source prompt: navigate, fill fields using
    selectors from locator_map.json, handle page transitions, verify success criteria.
    If anything fails, STOP and record facts. Do not try random alternatives.
  </step>

  <step id="5" name="write-findings" type="AUTO">
    [AUTO] Write findings document following the structure defined in the source prompt.
    Output path: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/walkthrough_findings/WALKTHROUGH__<TESTCASE_ID>__<ENV>__iter-<ITERATION>__<timestamp>.md`
    Include all six required sections from the source prompt.
  </step>

  <step id="6" name="report-in-chat" type="USER">
    [USER] Present walkthrough results to user:
    - Filepath created: [absolute path]
    - Result: PASS or FAIL
    - Top blockers (if any): [1-3 critical issues]

    Ask: "Would you like me to:
    1. Fix the issues found (recommend frameworks/wordpress/qa/prompts/02_LOCATORS_AND_CORRECTION.md)
    2. Run another walkthrough with different parameters
    3. Proceed with parallel run across all environments"

    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to the project root containing `playwright_phased_runner/` (e.g., `/path/to/workspace/projects/wordpress__qa__your-project`)</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="ENV">Environment: A-logged_out, B-logged_in, C-incognito, etc.</input>
    <input name="ITERATION">Integer, used for filename</input>
    <input name="GOAL">What we are validating (e.g. "VSN is populated on 88839 before submit")</input>
  </required>
  <optional>
    <input name="RUNSET_ID">For correlating to an existing runset folder</input>
  </optional>
</inputs>

<outputs>
  <output name="findings-doc">
    `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/walkthrough_findings/WALKTHROUGH__<TESTCASE_ID>__<ENV>__iter-<ITERATION>__<timestamp>.md`
  </output>
  <output name="chat-summary">
    Filepath, PASS/FAIL status, top 1-3 blockers
  </output>
</outputs>

<success_criteria>
- Findings document exists on disk at the correct path
- All six required sections are present in the document
- No repo files were modified (FINDINGS_ONLY enforced)
- Selector observations reference actual locator_map.json entries
- PASS/FAIL determination is based on defined success criteria, not guesswork
- Chat output includes filepath, result, and blockers
</success_criteria>
