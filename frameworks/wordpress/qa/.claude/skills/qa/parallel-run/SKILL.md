---
name: parallel-run
description: >
  Executes a testcase across A/B/C environments in parallel using subagents, compiles per-env
  reports and a manager summary. Operates in strict RUN_ONLY mode with no fixes, no reruns,
  and no code modifications. Allocates a runset, spawns one subagent per environment, triages
  results, and produces a manager report. Use when ready to execute a validated testcase.
---

<objective>
Allocate a runset, execute the testcase in parallel across target environments using subagents,
then produce per-env reports and a consolidated manager summary with triage of any failures.

This skill wraps the detailed procedure defined in the source prompt. The executor MUST read
the source prompt file in full before proceeding. The source prompt contains both the manager
procedure and the subagent instructions that must be passed verbatim to spawned subagents.

CRITICAL CONSTRAINT: This skill operates in RUN_ONLY mode. If errors are encountered,
ONLY REPORT them. Do NOT attempt to fix issues, modify selectors, update code, or rerun tests.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/04_PARALLEL_RUN_MANAGER.md
</source_prompt>

<prompt_type>Playbook (orchestrator)</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV, TAGS)
- 09_SHARED_BLOCKS.md § B — Operating rules (RUN_ONLY mode)
- 09_SHARED_BLOCKS.md § C — Report templates (§ C.1 env.report.md, § C.2 manager report)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language
</shared_blocks_references>

<model_recommendation>
sonnet -- Orchestration with subagent spawning. The manager coordinates parallel execution and
compiles reports. Subagents perform mechanical work (run CLI commands, read evidence files).
Neither requires opus-level reasoning. Use the same model for subagents to reduce
instruction-following drift per the source prompt's guidance.
</model_recommendation>

<execution_mode>
RUN_ONLY -- Execute tests and report results. No fixes, no reruns, no code modifications.
After writing the manager report, STOP. If fixes are needed, recommend the appropriate
follow-up prompt to the user.
</execution_mode>

<quick_start>
1. [AUTO] Read the source prompt: frameworks/wordpress/qa/prompts/04_PARALLEL_RUN_MANAGER.md
2. [GATE: testcase_id or project_root not provided] Gather testcase_id and project_root from user. **STOP and wait for user response before proceeding.**
3. [AUTO] Allocate a new runset via CLI
4. [AUTO] Spawn one subagent per environment (A, B, C) in parallel
5. [AUTO] Each subagent runs its env and writes an env report
6. [AUTO] Manager compiles runset report, triages failures (surface-level only)
7. [AUTO] Write manager report to runset directory
8. [USER] STOP -- recommend next prompt if action is needed. **STOP and wait for user response before proceeding.**
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, verify testcase readiness:

```bash
# Verify testcase exists and has required files
cd "{project_root}" && ls playwright_phased_runner/testcases/{testcase_id}/testcase.json playwright_phased_runner/testcases/{testcase_id}/locator_map.json playwright_phased_runner/testcases/{testcase_id}/identity.json 2>/dev/null || echo "Missing testcase files"

# Check framework CLI availability
cd "{project_root}" && node framework/runner/cli.js --help 2>/dev/null | head -3 || echo "CLI not found"

# List existing runsets
cd "{project_root}" && ls playwright_phased_runner/testcases/{testcase_id}/runs/ 2>/dev/null || echo "No previous runs"
```
</context>

<inputs>
  <required>
    <input name="testcase_id" description="The testcase to run (e.g., wpforms_88839_from_vdp_vsn_apply)" />
  </required>
  <optional>
    <input name="project_root" description="Path to project containing playwright_phased_runner/testcases/. Default: current working directory." />
    <input name="environments" description="Comma-separated env list. Default: A-logged_out,B-logged_in,C-incognito" />
    <input name="tags" description="Comma-separated tags to store in runset.meta.json" />
  </optional>
</inputs>

<outputs>
  <output path="playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/derived/runset.manager_report.md" description="Consolidated manager summary with triage" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/{env}/derived/env.report.md" description="Per-environment short report (one per env)" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/derived/runset.summary.json" description="Structured runset summary (from CLI report command)" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/derived/runset.summary.md" description="Human-readable runset summary (from CLI report command)" />
</outputs>

<delegation_plan>
Per 09_SHARED_BLOCKS.md § G: If subagents are available, delegate per-env runs in parallel;
otherwise run sequentially.

| Sub-task | Subagent | Inputs | Outputs |
|----------|----------|--------|---------|
| Run env A | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=A-logged_out | env.report.md, structured status |
| Run env B | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=B-logged_in | env.report.md, structured status |
| Run env C | Env Runner | PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENV=C-incognito | env.report.md, structured status |
| Manager (you) | — | Per-env outputs | runset.manager_report.md |

Model selection: Use same model for manager and subagents. If cheaper model used for
subagents, restrict to mechanical work and verify they did not propose fixes.
</delegation_plan>

<automated_workflow>
  <step number="1" name="load_source_prompt" type="AUTO">
    [AUTO] Read the full source prompt file:
    ```
    frameworks/wordpress/qa/prompts/04_PARALLEL_RUN_MANAGER.md
    ```
    This contains both the manager procedure (Steps 0-4) and the subagent instructions
    that must be provided to each spawned subagent.
  </step>

  <step number="1a" name="changelog_check" type="GATE" condition="re-run after fixes">
    [GATE: user indicates this run is post-fix verification]

    If the user indicates this is a re-run after developer fixes (e.g., "rerun after fix",
    "verification run", "post-patch run"):

    1. Check for changelog at `playwright_phased_runner/changelogs/LATEST.txt`
    2. If LATEST.txt exists, read the referenced changelog file
    3. If missing or outdated (older than fixes being verified), ask:

    ```
    This appears to be a post-fix verification run.

    Has the developer created a changelog documenting the fixes?

    Options:
    A) Provide changelog file path: [paste path]
    B) Run /framework:changelog-capture to interview the developer
    C) Skip changelog (will be created after verification passes)
    ```

    4. If user provides a changelog path:
       - Validate file exists and has expected structure
       - Copy to canonical location if not already there
       - Update LATEST.txt pointer

    5. Record changelog_status: PRESENT | ABSENT | SKIPPED

    **STOP and wait for user response before proceeding.**

    If user does NOT indicate this is a post-fix run, proceed to Step 2 as [AUTO].
  </step>

  <step number="2" name="allocate_runset" type="GATE">
    [GATE: testcase_id and project_root not provided in inputs]

    If testcase_id or project_root are missing, ask user:
    "Please provide:
    - testcase_id: The testcase to run (e.g., wpforms_88839_from_vdp_vsn_apply)
    - project_root: Path to project (default: current working directory)
    - tags (optional): Comma-separated tags for this runset"

    **STOP and wait for user response before proceeding.**

    Once inputs are available, allocate a new runset using the framework CLI (do NOT guess the ID):
    ```bash
    cd "{project_root}" && node framework/runner/cli.js new-runset \
      --project-root "{project_root}" \
      --testcase "{testcase_id}" \
      --tags "{tags}"
    ```
    Parse stdout and record RUNSET_ID and RUNSET_META path.
    If no tags are provided, omit the --tags flag entirely.
  </step>

  <step number="3" name="spawn_subagents" type="AUTO">
    [AUTO] Spawn one subagent per environment in parallel. Each subagent receives the
    "Subagent Instructions" block from the source prompt with these values substituted:
    - PROJECT_ROOT
    - TESTCASE_ID
    - RUNSET_ID
    - ENV (the specific environment for that subagent)

    Each subagent will:
    1. Run: cd "{project_root}" && node framework/runner/cli.js run --project-root "{project_root}" --testcase "{testcase_id}" --runset "{runset_id}" --env "{env}"
    2. Write env.report.md to {env}/derived/ per template § C.1
    3. Return structured status: PASS | FAIL | PREFLIGHT_FAIL

    CRITICAL: Subagent instructions must include the RUN_ONLY constraint.
    Subagents must NOT fix selectors, modify code, or rerun tests.
  </step>

  <step number="4" name="manager_triage" type="AUTO">
    [AUTO] After all subagents return, run the report compiler:
    ```bash
    cd "{project_root}" && node framework/runner/cli.js report \
      --project-root "{project_root}" \
      --testcase "{testcase_id}" \
      --runset "{runset_id}"
    ```

    For any env with status other than PASS, read these files for fast triage:
    - {env}/derived/run.summary.json
    - {env}/evidence/run.error.json (if present)
    - {env}/evidence/console.errors.summary.md (if present)
    - Failure screenshots under {env}/evidence/

    Document errors in the manager report. Do NOT diagnose root cause beyond
    surface-level analysis. Do NOT fix anything.
  </step>

  <step number="5" name="write_manager_report" type="AUTO">
    [AUTO] Write the manager summary report to:
    playwright_phased_runner/testcases/{testcase_id}/runs/{runset_id}/derived/runset.manager_report.md

    Per template in 09_SHARED_BLOCKS.md § C.2. Include:
    - PROJECT_ROOT, TESTCASE_ID, RUNSET_ID, ENVS, tags
    - Overall status: ALL_PASS | SOME_FAILED | BLOCKED
    - Results table: env | status | run folder | submit.success | primary failure reason | key evidence paths
    - Links to runset.summary.md and per-env reports
  </step>

  <step number="6" name="stop_and_recommend" type="USER">
    [USER] STOP after writing the manager report. Do NOT implement fixes.

    Present to user:
    1. Paths to all generated reports
    2. Overall status (ALL_PASS / SOME_FAILED / BLOCKED)
    3. List of failures found (if any, without fixing them)
    4. Changelog status (from Step 1a if applicable):
       - PRESENT: "Changelog available at [path]"
       - ABSENT: "No changelog found — dev should create one after fixes"
       - SKIPPED: "Changelog collection skipped by user"
       - N/A: "Initial run (not a post-fix verification)"

    **If ALL_PASS:**
    All environments passed test execution. Note: passing tests confirm form submission
    completed — backend validation (CRM records, payload correctness) requires verification.

    Recommended next steps:
    - `/framework:compile-dev-bundle` — Validate CRM payload correctness and create developer handoff
    - `/framework:report` — Generate detailed runset report
    - `/framework:anomaly-index` — Cross-run pattern analysis (if multiple runsets exist)
    - Run additional testcases

    If this was a post-fix verification run and changelog is ABSENT:
    - `/framework:changelog-capture` — Interview developer to document the fixes

    Ask: "All environments passed. Would you like to:
    1. Validate CRM/payload correctness (compile-dev-bundle)
    2. Generate detailed report
    3. Run anomaly analysis
    4. Capture dev changelog (if fixes were made)
    5. Run another testcase
    6. Done for now"

    **If SOME_FAILED or BLOCKED:**
    Recommended next prompt based on failure type:
    - Selector/flow fixes: `/framework:locator-correct`
    - Deep analysis: `/framework:pipeline-analysis`
    - Developer handoff: `/framework:report`

    Ask: "Which next step would you like to take?"

    **STOP and wait for user response before proceeding.**
  </step>
</automated_workflow>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Runset allocation fails | Check CLI is accessible; report error |
| Env run crashes mid-execution | Record FAIL status with error; do not retry |
| All envs fail (BLOCKED) | Report BLOCKED; recommend checking testcase definitions |
| Subagent proposes fixes | Manager rejects; re-verify no code changes made |
</failure_modes>

<success_criteria>
- Runset allocated with a unique ID (not guessed)
- If post-fix verification run: changelog check (Step 1a) executed with user prompt
- Changelog status recorded: PRESENT | ABSENT | SKIPPED | N/A
- All target environments executed (one subagent per env)
- No subagent attempted fixes, reruns, or code modifications
- Per-env reports written to {env}/derived/env.report.md
- Manager report written to derived/runset.manager_report.md
- Report includes results table with status and evidence paths for every env
- Final summary includes changelog status
- If failures found: documented but NOT fixed; failure remediation prompts recommended
- If ALL_PASS: confirmed with evidence paths; validation-oriented next prompts offered (compile-dev-bundle, report, anomaly-index)
- If ALL_PASS and changelog ABSENT: changelog-capture offered as option
- User prompted with context-appropriate next step options before skill terminates
</success_criteria>
