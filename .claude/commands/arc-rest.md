---
description: Transition the current actor arc to resting with a recorded reason
mode: PATCH_ALLOWED
---

<objective>
Transition the current actor arc to resting with a recorded reason. This is a state transition on the current arc only.
</objective>

<process>
- Step 1 — Resolve context: Resolve the actor id from $ARGUMENTS or environment (MYTHOS_ACTOR_ID, etc.). Treat remaining arguments as the recorded rest reason.
- Step 2 — Transition state: Run node-based transition via tools/kernel/lib/arc-state-writer.cjs, setting lifecycle_state to 'resting' and recording the reason.
- Step 3 — Report outcome: Output the updated arc snapshot JSON.
</process>

<success_criteria>
- The current arc snapshot is updated to lifecycle_state: resting
- A durable history entry carries the supplied reason
</success_criteria>
