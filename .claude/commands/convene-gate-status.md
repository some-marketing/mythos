---
description: Report whether the convene gate is enabled and what it protects
mode: REVIEW_ONLY
---

<objective>
Check the status of the convene gate in .claude/settings.json, list protected paths and trigger keywords, and report the most recent convene run.
</objective>

<process>
- 1. Check if .claude/settings.json contains a hook entry referencing pre-write-convene-required.cjs.
- 2. List the protected paths: ^tools/council/, ^tools/convene/, ^tools/verify/hooks/.*convene, ^instructions/canonical/, .claude/settings.json.
- 3. List the trigger keywords: kernel, convene, council, distinct intelligence, acceptance-grade, enforcement, lobe.
- 4. Find the most recent artifact in _dev/reports/analysis/convene-runs/ and its timestamp.
- 5. Report the receipt requirement: protected governance writes require a live ConveneReceipt/1.0 covering the path; keyword-only matches are advisory.
- 6. Present the findings in a single short table. Lead with status, no preamble.
</process>

<success_criteria>
- Status (Enabled/Disabled) is clearly reported
- Protected paths and keywords are listed correctly
- Recent activity is identified or noted as 'None'
- Output is presented as a single short table without preamble
</success_criteria>
