---
description: Claim a client-board intake item and advance it into bounded planning
mode: REVIEW_ONLY
---

<objective>
Select a specific intake item from a client board triage, prepare it for bounded planning via /plan-task, and optionally produce a guarded Dart writeback payload.
</objective>

<process>
- Resolve the client code and item ID from arguments.
- Load the latest triage artifact for this client from _dev/reports/analysis/ (client-board-triage__* or client-board-watch__*).
- Find the target item by task ID. If not found or not actionable (pick_up_now or plan_first), report why and stop.
- Extract item context: task ID, title, summary, classification, overlap, board name.
- Run the plan-task workflow (load .claude/skills/plan-task/SKILL.md) with the item title as task description and --client flag. Pass the --client flag from the item's client context so scope_type is correctly determined.
- After the plan is produced, build a planning breadcrumb writeback payload using buildWritebackPayload() from the shared lib with plan context (artifact path, framework match, next gate, run command). Present the comment for operator confirmation and post to Dart. Skip only if --no-writeback is set.
- Write a claim record to the plan artifact (claimed_from, source_artifact_path, dart_task_id) to prevent re-surfacing on next watcher cycle.
</process>

<success_criteria>
- Target item found in latest triage artifact
- Item eligibility verified (actionable classification)
- Plan-task workflow completed with Dart context
- Plan artifact includes claim record with source traceability
- Planning breadcrumb posted to Dart with confirmation (unless --no-writeback)
</success_criteria>

<handoff>
plan_produced: Review the plan artifact, then route execution via run-plan <task-id> or implement directly from the task plan
writeback_confirmed: Dart comment added with planning breadcrumb
overlap_detected: Update the existing workstream instead of creating a new plan
</handoff>
