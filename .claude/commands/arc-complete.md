---
description: Mark the current actor arc complete with a closeout evidence pointer
mode: PATCH_ALLOWED
---

<objective>
Mark the current actor arc complete with a closeout evidence pointer. Use this only when closeout evidence already exists.
</objective>

<process>
- Step 1 — Resolve context: Resolve the actor id from $ARGUMENTS or environment (MYTHOS_ACTOR_ID, etc.). Treat remaining arguments as the closeout evidence pointer.
- Step 2 — Mark complete: Run node-based completion via tools/kernel/lib/arc-state-writer.cjs, updating lifecycle_state to 'arc-complete' with end reason and evidence path.
- Step 3 — Report outcome: Output the updated arc snapshot JSON.
</process>

<success_criteria>
- The current arc snapshot is updated to lifecycle_state: arc-complete
- Snapshot contains arc_ended_at, end_reason, and the supplied closeout evidence pointer
</success_criteria>
