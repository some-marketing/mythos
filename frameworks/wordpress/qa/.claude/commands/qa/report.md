---
description: Analyze test runs and produce developer handoff documents
argument-hint: "[testcase-id] [runset-id]"
allowed-tools: Task
---

<objective>
Analyze completed test runs and produce a structured developer handoff
report by invoking the `framework/report-handoff` skill. Summarizes
pass/fail status, failure patterns, and observational findings with hypotheses for developer review.
</objective>

<process>
1. **Parse arguments**
   - Extract `testcase-id` and `runset-id` from `$ARGUMENTS`.
   - If `runset-id` is missing, use the most recent runset for the testcase.
   - If `testcase-id` is also missing, prompt the user interactively.

2. **Load run data**
   - Read the run results for the specified runset across all environments.
   - Gather logs, screenshots, and assertion outcomes.

3. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/report-handoff/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill analyzes failures, groups them by observed pattern, and generates
     the handoff document with hypotheses and open questions.

4. **Deliver the report**
   - Write the report to the testcase's output directory.
   - Display a summary to the user with pass/fail counts and key findings.
</process>

<context>
Source prompt: `frameworks/wordpress/qa/prompts/03_REPORT_AND_DEV_HANDOFF.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/report-handoff/SKILL.md`
Mode: FINDINGS_ONLY -- no code changes permitted.
Guardrails: `frameworks/wordpress/qa/guardrails.md#observational-reporting`

Recent testcase runsets:
- If you are in the project root already: `for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
</context>

<success_criteria>
- Report covers all environments in the runset
- Each failure includes evidence summary, hypotheses (labeled), and open questions for the developer
- Handoff document is written to the testcase output directory
- Summary with pass/fail breakdown is displayed to the user
</success_criteria>
