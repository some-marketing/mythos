---
description: Tabular rollup of subagent dispatches, metrics, and costs
mode: COORDINATOR
---

<objective>
Provide proprioception of system costs and subagent performance
</objective>

<process>
- Resolve arguments: extract --scope and --since if provided.
- Invoke the rollup tool (tools/telemetry/dispatches/rollup.cjs) via Bash.
- Present the tabular summary of mean, p50, and p95 metrics to the operator.
</process>

<success_criteria>
- Rollup table emitted with p50/p95 stats
- Filters correctly applied
- Exit 0
</success_criteria>
