---
description: Generate developer-facing packet readable in under 10 minutes (REVIEW_ONLY)
argument-hint: <testcase-id> <runset-id>
allowed-tools: Task
---

<objective>
Invoke the framework/dev-packet skill to generate a high-signal, developer-facing
packet with a small evidence map and clear next actions. The packet should be
readable in under 10 minutes.
</objective>

<context>
This command wraps Prompt 12 (Dev Packet Generator). It operates in REVIEW_ONLY
mode -- no runs are executed, no fixes applied.

The dev packet distills runset results, error evidence, failure screenshots, and
optional export comparisons into a concise document optimized for developer
consumption. It prioritizes signal over completeness.
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - TESTCASE_ID (required)
   - RUNSET_ID (required)

2. If any required argument is missing, prompt the user for it.

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/dev-packet/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.

4. The skill will:
   a. Read runset summary, manager report, and per-env reports
   b. Collect error evidence and failure screenshots
   c. Optionally include export comparison data
   d. Produce a concise dev packet with:
      - Executive summary (pass/fail per env)
      - Evidence map with file pointers
      - Prioritized next actions
</process>

<success_criteria>
- Skill definition file (frameworks/wordpress/qa/.claude/skills/qa/dev-packet/SKILL.md) read and understood
- Both required arguments parsed and validated
- Dev packet (For_Dev.md) written and readable in under 10 minutes
- Evidence map (evidence.map.json) references valid file paths
- All observational reporting compliance rules followed (zero prescriptive content)
</success_criteria>
