---
description: Triage client-board intake into pickup-ready work, planning work, and clarification work
mode: REVIEW_ONLY
---

<objective>
Inspect a client board as the intake surface, classify each open item by pickup eligibility, and write durable triage artifacts that name the exact next command for each actionable item.
</objective>

<process>
- Resolve the client scope from arguments and determine the relevant board or intake surface.
- Read the governing task-routing sources before classifying work: frameworks/project-management/dart-collaboration/docs/BOARD_CONVENTIONS.md, frameworks/project-management/dart-collaboration/docs/WORKSPACE_LINKING.md, frameworks/project-management/feedback-to-tasks/guardrails.md, and the plan-task skill contract.
- Gather the current intake surface: when live Dart access is available, inspect the open client-board items from Dart; otherwise inspect exported or repo-linked intake artifacts for the same client.
- Inspect repo truth for overlap: linked project task indexes when present, active task-plan artifacts, and live coordination signals.
- Evaluate every candidate item with the pickup-eligibility test and classify it into exactly one of: pick_up_now, plan_first, needs_clarification, update_existing, blocked, ignore.
- For each non-ignored item, record the source task or thread identifier, short summary, classification, rationale, overlap with any existing repo workstream or Dart task, and the truthful next command when actionable.
- Write two artifacts: _dev/reports/analysis/client-board-triage__<client>__<date>.md and _dev/reports/analysis/client-board-triage__<client>__<date>.json.
- When a linked Dart task already exists, include a proposed writeback payload in the artifact: planning breadcrumb, clarification request, merge/update note, or blocker note. Do not mutate Dart directly from this command.
- When a proposed Dart writeback sets or preserves Decision Needed, the comment must state the decision or question, why it matters, and what response unblocks the work. Do not leave Decision Needed as a status-only signal.
- Report the pickup-ready set, the planning-first set, the clarification/blocker set, and the exact next commands.
</process>

<success_criteria>
- Every open intake item inspected received exactly one classification
- Pickup-eligible items separated from clarification/blocker items
- Triage markdown and JSON artifacts written
- Every actionable item has an exact next command or an explicit reason it cannot advance
- Linked Dart writeback payloads included when applicable
</success_criteria>

<handoff>
pickup_ready_items: plan-task <task description> [--client CODE] [--project ID]
existing_work_overlap: Update the existing linked task or workstream instead of creating a new lane
clarification_needed: Ask the specific blocking question in Dart before planning
blocked_items: Leave in a blocked/decision-needed state until the gate clears
</handoff>
