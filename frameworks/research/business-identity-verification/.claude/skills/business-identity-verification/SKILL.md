---
name: business-identity-verification
description: Verify a business identity using public sources with evidence and privacy guardrails.
---

<skill>
<objective>
Verify a business identity and public contact footprint using lawful, public sources. Runs a fixed three-prompt chain — intake, public search, evidence review — producing an evidence-backed report.json plus an evidence-log.json for a candidate business name, known aliases, domain, or phone supplied by the operator.
</objective>

Use the three prompts in order. Keep outputs scoped to public business information, cite every material finding, and stop at the review gate before any outreach or external action.

<success_criteria>
  <criterion>All three prompt chain phases (intake, public-search, evidence-review) executed in order</criterion>
  <criterion>Output artifacts (report.json, evidence-log.json) match the output contract in manifest.json</criterion>
  <criterion>Every material finding is source-cited; no unverifiable claims presented as fact</criterion>
  <criterion>Research stays scoped to public business information; no outreach or external action taken</criterion>
</success_criteria>
</skill>
