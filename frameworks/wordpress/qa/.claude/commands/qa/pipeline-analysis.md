---
description: Trace values through full pipeline with field-by-field truth table (REVIEW_ONLY)
argument-hint: <testcase-id> <runset-id>
allowed-tools: Task
---

<objective>
Invoke the framework/deep-pipeline-analysis skill to trace expected values through
the full data pipeline (identity -> automation checks -> WPForms export -> CRM export)
and produce an actionable analysis report.
</objective>

<context>
This command wraps Prompt 10 (Deep Pipeline Analysis). It operates in REVIEW_ONLY
mode -- no runs are executed, no fixes applied.

Use when:
- The UI run is PASS but backend data is wrong or missing
- You have WPForms + CRM exports and need a field-by-field truth table
- You suspect mapping contract drift (labels or columns changed)
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - TESTCASE_ID (required)
   - RUNSET_ID (required)

2. If any required argument is missing, prompt the user for it.

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/deep-pipeline-analysis/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.

4. The skill will:
   a. Locate and read WPForms + CRM export CSVs under the runset
   b. Run deterministic export comparison tooling
   c. Build a field-by-field truth table (expected vs actual)
   d. Identify contract drift, missing fields, and mapping errors
   e. Produce an actionable pipeline analysis report
</process>

<success_criteria>
- Skill definition at `frameworks/wordpress/qa/.claude/skills/qa/deep-pipeline-analysis/SKILL.md` successfully read
- Both required arguments (testcase-id, runset-id) parsed and validated
- Field-by-field truth table generated
- Pipeline analysis report written to the runset derived directory
</success_criteria>
