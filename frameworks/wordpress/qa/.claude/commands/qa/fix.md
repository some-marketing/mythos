---
description: Apply minimal fixes to failing environments (PATCH_ALLOWED)
argument-hint: "[testcase-id] [runset-id]"
allowed-tools: Task
---

<objective>
Apply minimal, targeted fixes to failing environments by invoking the
`framework/implement-fixes` skill. This is a PATCH_ALLOWED operation --
only the smallest changes necessary to resolve failures are permitted.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` and `runset-id` from `$ARGUMENTS`.
   - If `runset-id` is missing, use the most recent runset for the testcase.
   - If `testcase-id` is also missing, prompt the user interactively.

2. **Load failure context**
   - Read the run results for the specified runset.
   - Identify which environments failed and the root cause of each failure.
   - Load the relevant testcase files (locator map, identity, step definitions).

3. **Read and follow the skill**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/implement-fixes/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill analyzes each failure, determines the minimal patch, and
     applies fixes to the testcase files.

4. **Review and confirm**
   - Present the proposed changes as a diff for user review.
   - Apply approved changes to the testcase folder.
   - Suggest re-running with `/framework:parallel-run` to verify the fixes.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/07_IMPLEMENT_FIXES.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/implement-fixes/SKILL.md`
Mode: PATCH_ALLOWED -- only minimal, targeted fixes are permitted.
Guardrails: `frameworks/wordpress/qa/guardrails.md#file-modification-rules`

Recent run summaries:
- If you are in the project root already: `find playwright_phased_runner/testcases -path "*/derived/run.summary.json" -mtime -7 2>/dev/null | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && find playwright_phased_runner/testcases -path "*/derived/run.summary.json" -mtime -7 2>/dev/null | head -5`
</context>

<success_criteria>
- Each failure has an identified root cause and corresponding fix
- Fixes are minimal -- no unrelated changes or refactoring
- Changes are presented for user review before being finalized
- User is directed to re-run to verify fixes
</success_criteria>
