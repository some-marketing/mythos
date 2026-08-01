---
description: Transition the current actor arc to blocked with a named dependency
mode: PATCH_ALLOWED
---

<objective>
Transition the current actor arc to blocked state when an external dependency or judgment gate exists. Blocked means an external dependency or judgment gate exists. It is not a synonym for rest.
</objective>

<process>
- Step 1 — Resolve context: Resolve the actor id from $ARGUMENTS or environment (MYTHOS_ACTOR_ID, etc.). Treat remaining arguments as the dependency.
- Step 2 — Execute transition: Run node-based transition via tools/kernel/lib/arc-state-writer.cjs, setting lifecycle_state to 'blocked' and recording the dependency as evidence.
- Step 3 — Report outcome: Output the updated arc snapshot JSON.
</process>

<success_criteria>
- The current arc snapshot is updated to lifecycle_state: blocked
- The blocker is recorded in transition evidence
</success_criteria>
