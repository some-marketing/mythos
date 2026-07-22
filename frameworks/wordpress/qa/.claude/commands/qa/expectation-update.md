---
description: Update testcase expectations based on dev changelog (PATCH_ALLOWED)
argument-hint: <testcase-id> [changelog-path]
allowed-tools: Read, Edit, Write, Glob, Grep, AskUserQuestion
---

<objective>
Update testcase expectation files (EXPECTED_OUTCOMES.md, expected_payload.json)
to reflect intentional behavioral and data format changes documented in a dev
changelog. Every change requires user confirmation before applying.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` from `$ARGUMENTS` (required, can be comma-separated for multiple)
   - Extract `changelog-path` from `$ARGUMENTS` (optional, defaults to LATEST.txt)
   - If testcase-id missing, list available testcases and prompt user to select

2. **Pre-flight checks**
   - Verify the testcase folder(s) exist
   - Verify expected_payload.json and/or EXPECTED_OUTCOMES.md exist for each testcase
   - If changelog-path not provided, read from `playwright_phased_runner/changelogs/LATEST.txt`
   - Verify changelog file exists and has content

3. **Execute the skill workflow**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/expectation-updater/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - Parse changelog for behavioral and data format changes
   - Generate proposed updates for each testcase
   - Present each update to user for confirmation (yes/no/modify)
   - Apply confirmed changes, preserve file formatting

4. **Report results**
   - Display summary of applied/declined/skipped changes
   - Show paths to updated files
   - Suggest next steps: `/framework:parallel-run` to verify updated expectations
</process>

<context>
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/expectation-updater/SKILL.md`
Agent definition: `frameworks/wordpress/qa/.claude/agents/qa/expectation-updater-agent.md`
Mode: PATCH_ALLOWED -- updates expectation files only, requires user confirmation
</context>

<success_criteria>
- Changelog parsed and changes extracted
- All testcases processed
- Each proposed update presented with changelog evidence
- Only user-confirmed changes applied
- Summary generated with all applied/declined changes
- File formatting preserved
</success_criteria>
