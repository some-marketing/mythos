---
description: Browser walkthrough to troubleshoot automation flow (FINDINGS_ONLY)
argument-hint: "[testcase-id] [env]"
allowed-tools: Task
---

<objective>
Perform an interactive browser walkthrough of a testcase on a specific
environment by invoking the `framework/mcp-walkthrough` skill. This is a
FINDINGS_ONLY operation -- observations are recorded but no fixes are applied.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` and `env` from `$ARGUMENTS`.
   - If `env` is missing, default to environment A or prompt the user.
   - If `testcase-id` is also missing, prompt the user interactively.

2. **Load testcase context**
   - Read the locator map, identity config, and environment URL.
   - Prepare the step sequence the walkthrough will follow.

3. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/mcp-walkthrough/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill opens the browser, walks through each step, captures
     screenshots, and records observations at each stage.

4. **Deliver findings**
   - Present a step-by-step findings report with screenshots.
   - Highlight any steps where locators failed or behavior diverged.
   - Save findings to the testcase output directory.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/mcp-walkthrough/SKILL.md`
Mode: FINDINGS_ONLY -- no code changes or fixes permitted.

Testcases live under `playwright_phased_runner/testcases/` relative to the project root.
</context>

<success_criteria>
- Browser walkthrough completes for every step in the testcase
- Each step has a screenshot and observation recorded
- Divergences and failures are clearly flagged
- No modifications are made to any files
</success_criteria>
