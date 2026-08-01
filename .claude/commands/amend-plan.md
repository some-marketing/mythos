---
description: Amend an existing task plan when execution reality diverges materially from plan assumptions
mode: REVIEW_ONLY
---

<objective>
Load an existing task plan, compare it against new execution facts, record changed assumptions and superseded elements, re-evaluate risk tier and review lane, and produce a durable amendment artifact. This is REVIEW_ONLY — amend the plan record, do not execute implementation work.
</objective>

<process>
- Resolve the plan artifacts using the shared task-plan resolver with $ARGUMENTS.
- Load the plan JSON and markdown. These are the baseline.
- Identify the execution facts that triggered the amendment. Execution facts are concrete changes observed during or after execution: completed steps that changed outputs, blocked steps with new blockers, dependency changes, split or reordered steps, new risk information, review lane changes, or gate failures.
- Compare the baseline plan against the execution facts. For each material divergence, classify it as one of: assumption_changed (a plan assumption is no longer true), step_blocked (a step cannot proceed as planned), step_split (a step must be split into multiple), step_reordered (dependency order changed), output_changed (declared outputs differ from what was produced or is now needed), gate_changed (a required gate was added, removed, or modified), risk_changed (risk tier or review lane needs updating), scope_exceeded (the change is too large for amendment).
- Apply the amendment threshold: small tactical steering within an already-bounded slice does NOT require amendment. Amendment is required only when the change affects dependencies, declared outputs, gates, trust tier, review lane, or acceptance criteria.
- If any divergence is classified as scope_exceeded, stop and recommend /plan-task <new-bounded-task> instead of amending. Explain why the change exceeds amendment scope.
- For each non-exceeded divergence, record: the original plan element, the new execution fact, the classification, and the recommended plan update.
- Re-evaluate risk tier and review lane based on the amended plan state. If the amendment introduces higher risk, escalate the review lane.
- Write the amendment artifacts: a markdown summary and a JSON artifact with structured divergences.
- The original plan JSON and markdown are NOT mutated. The amendment artifact is a companion that records what changed and why. The original plan remains the historical baseline.
- Emit one truthful exact next command based on the amended state.
</process>

<success_criteria>
- Plan artifacts loaded and baseline established
- Execution facts identified and compared against baseline
- Each material divergence classified with evidence
- Amendment threshold applied — small tactical changes excluded
- Risk tier and review lane re-evaluated
- Amendment artifacts written as companions to the original plan (original not mutated)
- One truthful exact next command emitted
- No implementation work attempted
</success_criteria>

<handoff>
amended_plan_executable: /run-plan <task-id>
amended_plan_needs_review: /review-task-plan <task-id>
scope_exceeded: /plan-task <new-bounded-task>
repo_truth_unclear: /review-progress <scope>
</handoff>
