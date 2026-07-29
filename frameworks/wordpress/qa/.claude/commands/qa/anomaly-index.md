---
description: Build cross-run anomaly index across multiple runsets (REVIEW_ONLY)
argument-hint: "[tag-filter]"
allowed-tools: Task
---

<objective>
Invoke the framework/cross-run-anomaly skill to build a cross-run index of recurring
anomalies and regressions across many runsets, with stable buckets and evidence
pointers.
</objective>

<context>
This command wraps Prompt 11 (Cross-run Anomaly Index). It operates in REVIEW_ONLY
mode -- no runs are executed, no fixes applied.

Use when you need to identify patterns across multiple test runs: recurring failures,
regressions introduced after fixes, or flaky environments.

The tag-filter argument is optional. If provided, only runsets matching the tag are
included (e.g. "smoke", "release-2026-01-27").
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - TAG_FILTER (optional) -- e.g. "smoke" or "release-2026-01-27"

2. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/cross-run-anomaly/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - Pass tag-filter argument (if provided)

3. The skill will:
   a. Generate a deterministic runset index using the indexing tool
   b. Read run summaries and error evidence for each indexed runset
   c. Build anomaly buckets grouping recurring issues
   d. Identify regressions (pass -> fail transitions)
   e. Produce a cross-run anomaly report with trend analysis
</process>

<success_criteria>
- Skill definition read from `frameworks/wordpress/qa/.claude/skills/qa/cross-run-anomaly/SKILL.md`
- Tag filter correctly applied (or omitted if none provided)
- Anomaly index generated with stable bucket identifiers
- Report written to the reports directory
</success_criteria>
