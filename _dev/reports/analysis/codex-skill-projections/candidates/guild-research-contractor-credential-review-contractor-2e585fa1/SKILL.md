---
name: guild-research-contractor-credential-review-contractor-2e585fa1
description: "Review public contractor credentials and reputation neutrally."
---

Framework lineage: `frameworks/research/contractor-credential-review`. Read its `manifest.json` and `guardrails.md` before execution. Source helper: `frameworks/research/contractor-credential-review/.claude/skills/contractor-credential-review/SKILL.md`.


<skill>
<objective>
Review publicly verifiable contractor credentials, licensing, insurance representations, and business reputation. Runs a fixed three-prompt chain — scope intake, credential search, risk review — for a candidate contractor or business identity within a declared jurisdiction, producing an evidence-backed report.json plus an evidence-log.json.
</objective>

Use the three prompts in order. Treat complaints as allegations, verify credentials at authoritative sources, and stop at the review gate before outreach or external action.

<success_criteria>
  <criterion>All three prompt chain phases (scope-intake, credential-search, risk-review) executed in order</criterion>
  <criterion>Output artifacts (report.json, evidence-log.json) match the output contract in manifest.json</criterion>
  <criterion>Credentials/licensing claims are verified against authoritative sources; complaints are labeled as allegations, not findings of fact</criterion>
  <criterion>No outreach or external action taken; review stays within the review gate</criterion>
</success_criteria>
</skill>
