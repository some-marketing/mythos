---
description: Set up a new testcase with locator map, identity, and folder structure
argument-hint: "[site-url]"
allowed-tools: Task
---

<objective>
Scaffold a new testcase by invoking the `framework/intake-scaffold` skill.
Given a site URL (from $ARGUMENTS or gathered interactively), produce
a complete testcase folder with locator map, identity config, and
environment definitions ready for execution.
</objective>

<process>
1. **Parse arguments**
   - If `$ARGUMENTS` contains a URL, use it as the target site URL.
   - If `$ARGUMENTS` is empty, prompt the user for the site URL interactively.

2. **Gather additional context**
   - Ask the user for a short testcase name / identifier if not obvious from the URL.
   - Confirm the target environments (default: A / B / C) the user wants configured.

3. **Execute the skill workflow**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/intake-scaffold/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill handles browser discovery, locator extraction, identity setup,
     and folder scaffolding.

4. **Validate outputs**
   - Confirm the testcase folder was created under the expected path.
   - Verify `locator_map.json`, `identity.json`, and environment configs exist.
   - Report the testcase ID and folder path back to the user.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/01_INTAKE_AND_SCAFFOLD.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/intake-scaffold/SKILL.md`

Existing testcases (to avoid duplicates):
- If you are in the project root already: `ls -1 playwright_phased_runner/testcases/ | head -10`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && ls -1 playwright_phased_runner/testcases/ | head -10`
</context>

<success_criteria>
- Testcase folder exists with all required files
- Locator map contains at least one valid selector
- Identity and environment configs are populated
- User receives the testcase ID for subsequent commands
</success_criteria>
