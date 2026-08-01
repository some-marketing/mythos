---
description: Cascade the full Mythos workstream pipeline — plan, review, execute, review-execution, approve, debrief, handoff, commit — as one operator-facing command
mode: COORDINATOR
---

<objective>
Ship a workstream end-to-end by resolving a plan or task description and running the opinionated 12-phase Mythos cascade.
</objective>

<process>
- Resolve arguments as existing plan id or one-line task description.
- Invoke ship-workstream skill to sequence phases: plan → review → preflight → run → review-execution → approve → debrief → handoff → commit.
- Monitor for stop conditions (gate rejection, error) at each phase boundary.
- Report status, commands, artifacts, and next phase at each boundary.
- Finalize with scoped commit SHA or exact blocker report.
</process>

<success_criteria>
- Skill invoked with resolved argument
- All phase boundaries return required metadata
- Stop conditions reported truthfully
- Final output includes commit SHA or clear blocker
</success_criteria>
