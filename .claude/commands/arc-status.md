---
description: Show the current actor-arc snapshot and lifecycle state for the resolving actor
mode: REVIEW_ONLY
---

<objective>
Show the current actor-arc snapshot and lifecycle state for the resolving actor.
</objective>

<process>
- Step 1 — Resolve actor: Resolve the actor id from $ARGUMENTS or environment (MYTHOS_ACTOR_ID, etc.) following defined precedence.
- Step 2 — Read state: Read the current arc snapshot from tools/kernel/lib/arc-state-writer.cjs.
- Step 3 — Report status: Print the full snapshot when present, or status: no-active-arc when absent.
</process>

<success_criteria>
- Operator sees the current lifecycle state, declared scope, and latest history for the resolved actor
- If no arc exists, report status: no-active-arc rather than inventing state
</success_criteria>
