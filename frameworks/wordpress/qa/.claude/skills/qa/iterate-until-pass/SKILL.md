---
name: iterate-until-pass
description: >
  Coordinates the end-to-end iteration loop for driving a failing testcase to
  stable PASS across all required environments. Orchestrates run, triage,
  stakeholder gate, walkthrough, fix, rerun, and report steps, delegating to
  canonical prompts 04/05/07/08/03/10 as needed. Use when a testcase is failing
  or flaky and needs a repeatable loop to reach stability.
---

<objective>
Act as the coordinator ("manager prompt") for the full iteration cycle:
run -> triage -> stakeholder gate -> walkthrough -> implement fixes -> rerun -> report.
Continue iterating until all required environments reach PASS or stop conditions
are met.

Source of truth: frameworks/wordpress/qa/prompts/06_ITERATE_UNTIL_PASS.md
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/06_ITERATE_UNTIL_PASS.md
</source_prompt>

<prompt_type>Playbook (coordinator)</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, GOAL, TAGS)
- 09_SHARED_BLOCKS.md § B — Operating rules (COORDINATOR mode)
- 09_SHARED_BLOCKS.md § F — Stakeholder Interview Gate (triggers when triage finds ambiguities)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language
</shared_blocks_references>

<execution_mode>
COORDINATOR — This skill orchestrates other prompts. It may invoke:
- 04_PARALLEL_RUN_MANAGER.md (for A/B/C runs, RUN_ONLY)
- 05_MCP_WALKTHROUGH_FINDINGS_ONLY.md (for live DOM investigation, FINDINGS_ONLY)
- 07_IMPLEMENT_FIXES.md (for repo changes, PATCH_ALLOWED)
- 08_RERUN_VERIFY.md (for post-fix verification, RUN_ONLY)
- 03_REPORT_AND_DEV_HANDOFF.md (for final reporting)
- 10_DEEP_PIPELINE_ANALYSIS.md (for backend proof, REVIEW_ONLY)
</execution_mode>

<model_recommendation>
opus — Complex multi-step orchestration requiring judgment calls on when to
triage vs walkthrough vs fix, managing iteration state across multiple
environments, and coordinating delegation to subordinate prompts. The
Stakeholder Interview Gate requires nuanced question formulation.
</model_recommendation>

<quick_start>
1. [USER] Collect inputs: PROJECT_ROOT, TESTCASE_ID, GOAL (plus optional MAX_ITERATIONS, TAGS, FAIL_FAST_SCOPE). **STOP and wait for user response before proceeding.**
2. [AUTO] Read the full source prompt: frameworks/wordpress/qa/prompts/06_ITERATE_UNTIL_PASS.md
3. [AUTO] Also read: frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md (§ A, § B, § F, § G)
4. [AUTO] Validate testcase definitions
5. [AUTO] Begin iteration loop (Steps 0-6 from source prompt)
6. [GATE: ambiguities found] If triage finds ambiguities: run Stakeholder Interview Gate (Step 2a)
7. [AUTO] Stop when all envs PASS or stop conditions are met
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
- frameworks/wordpress/qa/prompts/06_ITERATE_UNTIL_PASS.md (full procedure)
- frameworks/wordpress/qa/prompts/09_SHARED_BLOCKS.md (§ A, § B, § F, § G)
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/testcase.json`
- `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/locator_map.json`
</context>

<inputs>
  <required>
    <input name="PROJECT_ROOT">Path to the project root containing `playwright_phased_runner/` (e.g., `/path/to/workspace/projects/wordpress__qa__your-project`)</input>
    <input name="TESTCASE_ID">The testcase identifier</input>
    <input name="GOAL">What "PASS" means, including backend expectations if relevant</input>
  </required>
  <optional>
    <input name="TAGS">Comma-separated tags for runset</input>
    <input name="MAX_ITERATIONS">Maximum iteration cycles (default: 5)</input>
    <input name="FAIL_FAST_SCOPE">A-only or A/B/C</input>
  </optional>
</inputs>

<outputs>
  <output name="runset-artifacts">Per-environment run artifacts under <PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/</output>
  <output name="stakeholder-answers">stakeholder_answers.md (if gate triggered) under .../<RUNSET_ID>/derived/</output>
  <output name="findings-docs">Walkthrough findings (if walkthrough was invoked)</output>
  <output name="report">Final report and dev handoff package</output>
  <output name="chat-summary">Iteration count, final PASS/FAIL per env, escalation notes if any</output>
</outputs>

<delegation_plan>
Per 09_SHARED_BLOCKS.md § G: If subagents are available, delegate sub-tasks;
otherwise run sequentially.

Each iteration may delegate:

| Sub-task | Canonical Prompt | Mode | When |
|----------|-----------------|------|------|
| Parallel env run | 04_PARALLEL_RUN_MANAGER.md | RUN_ONLY | Step 1 (A/B/C needed) |
| Walkthrough | 05_MCP_WALKTHROUGH_FINDINGS_ONLY.md | FINDINGS_ONLY | Step 3 (UI/DOM ambiguous) |
| Implement fixes | 07_IMPLEMENT_FIXES.md | PATCH_ALLOWED | Step 4 (fixes required) |
| Re-run verify | 08_RERUN_VERIFY.md | RUN_ONLY | Step 4 (post-fix) |
| Report + handoff | 03_REPORT_AND_DEV_HANDOFF.md | — | Step 5 (stable PASS) |
| Pipeline analysis | 10_DEEP_PIPELINE_ANALYSIS.md | REVIEW_ONLY | Step 6 (backend proof) |
</delegation_plan>

<automated_workflow>
  <step id="0" name="validate-definitions" type="USER">
    [USER] Present collected inputs (PROJECT_ROOT, TESTCASE_ID, GOAL, MAX_ITERATIONS, TAGS, FAIL_FAST_SCOPE) to the user.
    Ask: "Proceed with iteration loop using these inputs?"
    **STOP and wait for user response before proceeding.**
  </step>

  <step id="1" name="allocate-and-run" type="AUTO">
    [AUTO] For initial baseline:
    - If single env (recommended early): allocate runset, run one env, compile report.
    - If A/B/C needed: delegate to frameworks/wordpress/qa/prompts/04_PARALLEL_RUN_MANAGER.md.
    Commands:
    ```
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js new-runset --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --tags "<TAGS>"
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js run --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --env "<ENV>"
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js report --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>"
    ```
    Report progress when complete.
  </step>

  <step id="2" name="triage-failures" type="AUTO">
    [AUTO] For each failing env, read run artifacts:
    - derived/run.summary.json
    - evidence/run.error.json, console.errors.summary.md, FAILURE.*.page.png
    Classify into: PREFLIGHT_FAIL, selector/DOM drift, timing/waits/page gating,
    conditional logic/skipped pages, validation/required fields, backend mismatch.
    Report findings in chat.
  </step>

  <step id="2a" name="stakeholder-interview-gate" type="GATE" condition="ambiguities found">
    **[GATE: triage revealed ambiguities about intended behavior]**

    CRITICAL: If triage in step 2 identified ANY of the following, you MUST stop here:
    - Fields empty in all envs (expected or regression?)
    - Cross-env differences (intended or bug?)
    - Skipped pages or conditional logic (correct or failure?)
    - Any behavior where "expected" vs "unexpected" is unclear

    **Detection rule:** If you cannot confidently classify a finding as "expected behavior"
    or "definite bug", then the gate condition is TRUE and you MUST stop.

    **If condition TRUE (ambiguities exist):**
    1. Present each ambiguity to the user IN CHAT (not just in files)
    2. Ask: "Before I proceed with fixes, I need clarification on these [N] items:"
    3. For each item, ask specifically:
       - "This field was empty in all envs — is that expected behavior or a regression?"
       - "Env B differs from A for field Y — is that the intended logged-in behavior?"
       - "The form skipped page 3 — is that conditional logic or a bug?"
    4. **STOP AND WAIT FOR USER RESPONSE. DO NOT PROCEED.**
    5. Record answers to `.../<RUNSET_ID>/derived/stakeholder_answers.md`
    6. Apply classification: expected → skip fix, unexpected → proceed to fix, unknown → escalate

    **If condition FALSE (no ambiguities):**
    Proceed directly to step 3.

    **Fallback (user explicitly unavailable):**
    Only if user explicitly says "skip" or "can't answer now":
    - Mark all ambiguous items as UNKNOWN
    - Note in report that stakeholder gate was skipped
    - Proceed to step 3 with conservative approach (don't fix what's ambiguous)
  </step>

  <step id="3" name="walkthrough-if-needed" type="AUTO">
    [AUTO] If UI/DOM is ambiguous and live DOM truth is needed:
    Delegate to frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
    (or invoke the mcp-walkthrough skill).
    Report findings path when complete.
  </step>

  <step id="4" name="implement-fixes" type="AUTO">
    [AUTO] If repo changes are required:
    Delegate to frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md
    (or invoke the implement-fixes skill).
    After fixes, rerun only failing envs via frameworks/wordpress/qa/prompts/08_RERUN_VERIFY.md
    (or invoke the rerun-verify skill).
    Report changed files and rerun results.
  </step>

  <step id="5" name="report-and-handoff" type="AUTO">
    [AUTO] When stable PASS is achieved:
    Delegate to frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md.
    Optionally produce portable bundle:
    `cd "<PROJECT_ROOT>" && node framework/runner/cli.js handoff --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>"`
    Report output paths when complete.
  </step>

  <step id="6" name="backend-proof" type="AUTO">
    [AUTO] If GOAL includes CRM/WPForms correctness:
    Download exports, run compare-exports, escalate to 10_DEEP_PIPELINE_ANALYSIS.md if needed.
    Report validation results.
  </step>

  <step id="loop" name="check-stop-conditions" type="USER">
    [USER] Present iteration summary:
    - Environments still failing (if any)
    - Iteration count vs MAX_ITERATIONS
    - STOP conditions met or ESCALATE conditions triggered
    Ask: "Continue iteration or stop?"
    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<failure_modes>
| Condition | Action |
|-----------|--------|
| PREFLIGHT_FAIL repeated | Escalate: auth/storage state likely stale; needs manual refresh |
| MAX_ITERATIONS exceeded | Stop; produce report of remaining failures; recommend manual investigation |
| Form behavior inconsistent across runs | Document flakiness pattern; recommend deterministic gating strategy |
| Walkthrough contradicts evidence | Trust live DOM (walkthrough) over stale evidence |
| Backend exports unavailable | Complete UI iteration; defer backend proof until exports available |
| Stakeholder unavailable for gate | Use § F fallback: mark UNKNOWN, list as questions pending review |
</failure_modes>

<success_criteria>
- All required environments reach PASS within MAX_ITERATIONS
- Each iteration cycle follows the canonical step order
- Stakeholder Interview Gate run when triage found ambiguities
- Delegation to subordinate prompts uses their canonical paths
- Stop conditions are checked after each cycle
- Escalation is raised if stop conditions are met without PASS
- Final report is produced when stable PASS is achieved
</success_criteria>
