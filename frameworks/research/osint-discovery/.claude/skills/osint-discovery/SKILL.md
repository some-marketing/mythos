---
name: osint-discovery
description: Route bounded public-source discovery across target types.
---

<skill>
<objective>
Route lawful public-source discovery for a bounded target at any research scope (organization, domain, project, technology, event, or authorized person-related target). Runs a fixed four-prompt chain — scope, source plan, discovery, synthesis — against an operator-declared purpose, producing a discovery-report.json plus an evidence-log.json.
</objective>

Run the four prompts in order. Require a declared purpose and stop conditions, then produce source-cited findings without outreach or private-data collection.

<success_criteria>
  <criterion>All four prompt chain phases (scope, source-plan, discovery, synthesis) executed in order</criterion>
  <criterion>Output artifacts (discovery-report.json, evidence-log.json) match the output contract in manifest.json</criterion>
  <criterion>A declared purpose and stop conditions are recorded before discovery begins</criterion>
  <criterion>Findings are source-cited; no outreach or private-data collection performed</criterion>
</success_criteria>
</skill>
