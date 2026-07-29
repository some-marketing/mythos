---
description: Re-run previously failing environments after fixes (RUN_ONLY)
argument-hint: <testcase-id> <reference-runset-id> <envs>
allowed-tools: Task
---

<objective>
Invoke the framework/rerun-verify skill to re-run only the environments that
previously failed, using a fresh runset ID. This is a post-fix verification step.
</objective>

<context>
This command wraps Prompt 08 (Re-run Verification). It operates in RUN_ONLY mode --
no fixes are applied, only re-execution and comparison against the reference runset.

Key safety rule: a new runset is always allocated. The old runset folder is never
reused to avoid overwriting or confusing evidence.
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - TESTCASE_ID (required)
   - REFERENCE_RUNSET_ID (required) -- the runset that contained failures
   - ENVS_TO_RERUN (required) -- comma-separated list, e.g. "A-logged_out,B-logged_in"

2. If any required argument is missing, prompt the user for it.

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/rerun-verify/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   Pass the required arguments:
   - testcase-id
   - reference-runset-id
   - envs-to-rerun

4. The skill will:
   a. Allocate a fresh runset (tagged as rerun of reference)
   b. Run only the specified environments
   c. Compare results against the reference runset
   d. Produce a verification report with evidence pointers
</process>

<success_criteria>
- Skill definition read from `frameworks/wordpress/qa/.claude/skills/qa/rerun-verify/SKILL.md`
- All three required arguments parsed and passed correctly
- Fresh runset allocated (never reusing reference runset folder)
- Verification report produced comparing old vs new results
</success_criteria>
