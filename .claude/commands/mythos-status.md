---
description: Consolidated operator status: queue truth, health, next step, signals
mode: REVIEW_ONLY
---

<objective>
Show consolidated Mythos operator status via npm run status — current queue, system health, maintenance state, live signals, next command, and planning freshness in one view.
</objective>

<process>
- Run npm run status to get the consolidated system status output.
- Present the output to the operator — it aggregates next-step resolution, system context, maintenance conditions, verify-system verdict, live signals, planning staleness, and inventory counts.
- If any findings require action, highlight them and recommend the exact next command.
- For deeper inspection, follow up with: npm run maintenance:status (full maintenance detail), npm run next-step --json (structured next-step data), or npm run test:instructions / npm run test:lifecycle (test detail).
</process>

<success_criteria>
- Operator gets a single-page view of system state
- Next command is visible without inspecting multiple surfaces
- Stale planning or failing maintenance surfaces are called out
- No need to run separate status, maintenance, and next-step commands
</success_criteria>

<handoff>
maintenance_issues_found: npm run maintenance:status
manifest_drift_detected: sync-manifest
stale_planning: plan-active-workstreams
test_failures: npm run test:instructions
command_discovery: npm run commands (full command reference by intent category)
</handoff>
