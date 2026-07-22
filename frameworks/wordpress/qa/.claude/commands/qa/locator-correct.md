---
description: Validate and correct locator map through browser walkthrough
argument-hint: "[testcase-id]"
allowed-tools: Task
---

<objective>
Validate and correct the locator map for an existing testcase by invoking
the `framework/locator-correction` skill. Walks through the live site in a
browser to verify each selector resolves, fixing any that fail.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` from `$ARGUMENTS`.
   - If missing, list available testcases and prompt the user to select one.

2. **Load testcase context**
   - Read the testcase's `locator_map.json` and environment config.
   - Identify the target URL for browser walkthrough.

3. **Execute the locator correction workflow**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/locator-correction/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The workflow opens the site in a browser, tests each locator, and
     produces a findings document with categorized corrections.
   - Mode is FINDINGS_ONLY: no files are modified during walkthrough.

4. **Present findings**
   - Display the findings report to the user.
   - Recommend next step: use `/framework:fix` to apply corrections.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/02_LOCATORS_AND_CORRECTION.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/locator-correction/SKILL.md`

Testcases live under `playwright_phased_runner/testcases/` relative to the project root.
</context>

<success_criteria>
- Every locator in the map was tested against the live page
- Findings document produced with categorized issues (CRITICAL, per-page, transition, etc.)
- No files modified (FINDINGS_ONLY enforced)
- User informed of next step: apply corrections via `/framework:fix`
</success_criteria>
