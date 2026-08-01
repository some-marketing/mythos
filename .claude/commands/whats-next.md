---
description: Daily boot sequence — surface what's done, blocked, and executable across all clients
mode: REVIEW_ONLY
---

<objective>
Produce a concise, actionable status of all active work: what completed since last session, what is blocked and on whom, what is executable right now, and the exact next command to run. This is the daily opener — the operator's morning briefing.
</objective>

<process>
- Check git state: current branch, clean/dirty status, last commit timestamp. If dirty, note file count and suggest /clean-house first.
- Refresh or read `_dev/reports/analysis/next-session-continuity.json` by running `npm run sessions:continuity` when available. Include the active handoff and recent archived system/client handoffs in the briefing so preserved handoffs remain operator-visible, not merely stored.
- Scan task plans: use the shared resolver's listAllTaskPlans() (tools/planning/lib/resolve-task-plan.js) to discover plans across both system and client roots, filter to --client code if provided, cross-reference against outcome artifacts in _dev/reports/analysis/task-outcomes/, classify each plan as COMPLETE (outcome exists), BLOCKED (missing dependency or operator decision), or EXECUTABLE (no blockers).
- Check for operator-gated items: plans with routing_expectations.review_lane operator-gate, open questions from prior handoff docs, signals requesting operator input.
- Check client boards if Dart MCP is available: query active client dartboards for new items since last session, flag any new intake items.
- Produce the briefing in structured format: COMPLETED SINCE LAST SESSION, BLOCKED (waiting on you), BLOCKED (waiting on external), READY TO EXECUTE (in priority order with run commands and risk levels), REPO STATE, and RECOMMENDED NEXT COMMAND.
- If running via iMessage, send a compact version: skip completed items unless notable, lead with blocked decisions, end with 'Reply go to start the queue'.
</process>

<success_criteria>
- Every active task plan is accounted for
- The active handoff and recent archived handoffs from the continuity index are surfaced or explicitly reported as unavailable
- No task is classified as EXECUTABLE if it has unmet dependencies
- Blocked items clearly state what decision or action is needed
- The recommended next command is actually runnable
- Briefing is produced in under 30 seconds
</success_criteria>

<handoff>
queue_ready: /run-plan <highest-priority-executable-task>
dirty_tree: /clean-house
new_intake: /claim-intake or /triage-client-board
blocked_on_operator: Operator makes decision, then /run-plan
</handoff>
