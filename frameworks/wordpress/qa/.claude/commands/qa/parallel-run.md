---
description: Execute testcase across A/B/C environments in parallel (RUN_ONLY)
argument-hint: "[testcase-id]"
allowed-tools: Task
---

<objective>
Execute a testcase across all configured environments (A/B/C) in parallel
by invoking the `framework/parallel-run` skill. This is a RUN_ONLY
operation -- no fixes or modifications are applied during execution.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` from `$ARGUMENTS`.
   - If missing, list available testcases and prompt the user to select one.

2. **Pre-flight checks**
   - Verify the testcase folder exists with a valid locator map and identity.
   - Confirm environment configs are present for each target environment.

3. **Execute the skill**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/parallel-run/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill will launch parallel execution across all environments.

4. **Report results**
   - Display per-environment pass/fail status.
   - Assign a runset ID and save all results to the testcase output directory.
   - Suggest next steps: `/framework:report` or `/framework:iterate`.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/04_PARALLEL_RUN_MANAGER.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/parallel-run/SKILL.md`
Mode: RUN_ONLY -- no code changes permitted during execution.
Guardrails: `frameworks/wordpress/qa/guardrails.md#execution-modes` (RUN_ONLY)

Testcases live under `playwright_phased_runner/testcases/` relative to the project root.
</context>

<success_criteria>
- All configured environments are executed
- Each environment produces a result (pass or fail with details)
- Runset ID is assigned and results are persisted
- No modifications are made to testcase files or application code
</success_criteria>
