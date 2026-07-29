---
description: Run iteration loop until testcase passes across all environments
argument-hint: "[testcase-id]"
allowed-tools: Task
---

<objective>
Run an iterative fix-and-rerun loop by invoking the `framework/iterate-until-pass`
skill. Repeats the cycle of running the testcase, analyzing failures, applying
minimal fixes, and re-running until all environments pass or the iteration
limit is reached.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` from `$ARGUMENTS`.
   - If missing, list available testcases and prompt the user to select one.

2. **Pre-flight checks**
   - Verify the testcase folder is complete (locator map, identity, env configs).
   - Confirm there is at least one prior run result or that a fresh run is needed.

3. **Read and follow the skill**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/iterate-until-pass/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill manages the iteration loop:
     a. Execute across all environments.
     b. Analyze failures from the run.
     c. Apply minimal, targeted fixes.
     d. Re-run and check results.
     e. Repeat until all pass or iteration cap is hit.

4. **Report outcome**
   - Display final pass/fail status per environment.
   - Summarize all fixes applied across iterations.
   - If the iteration cap was reached without full pass, recommend next steps.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/06_ITERATE_UNTIL_PASS.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/iterate-until-pass/SKILL.md`

Testcases live under `playwright_phased_runner/testcases/` relative to the project root.
</context>

<success_criteria>
- Iteration loop executes at least one full run-analyze-fix cycle
- All environments pass, or the iteration limit is reached with a clear report
- Every fix applied is minimal and documented
- Final status is reported with per-environment breakdown
</success_criteria>
