---
description: Plan a bounded operational approach for a task by comparing to hardened frameworks
mode: REVIEW_ONLY
---

<objective>
Compare a task to hardened Mythos frameworks, present top matches, generate a bounded plan with routing metadata, and write plan artifacts. This is REVIEW_ONLY — propose the plan, do not execute it.
</objective>

<process>
- Load and follow the skill at .claude/skills/plan-task/SKILL.md.
- Run node tools/planning/assess-similarity.js --task "$ARGUMENTS" --json to get framework matches, task_patterns, pattern_matches, and any broadening_recommendation.
- If broadening_recommendation.triggered is true, present scored top matches and broader workflow-pattern matches as separate evidence classes before accepting weak no-match routing. Pattern matches widen inspection; they do not fabricate framework certainty or override stronger contradictory evidence.
- Run node tools/planning/check-existing-work.js --task "$ARGUMENTS" --json to detect EXISTING task-plan overlap and recent signal/dispatch activity (incl. the background automation track) for this scope. If has_overlap is true: surface the highest-scoring owning plan(s) and recent in-flight dispatches, and PREFER routing to /amend-plan on the owning plan over authoring a parallel plan. Authoring a new plan despite a strong owning match requires an explicit reason. This is the mechanical don't-duplicate + coordinate-with-background-track gate.
- Present the top matches and generate a bounded plan.
- Determine scope_type: if the task has a client_code and is client delivery work, scope_type is 'client' with storage_root 'clients/{client_code}/plans'; if the task is framework, runtime, or cross-client system work, scope_type is 'system' with storage_root '_dev/reports/analysis/task-plans'. Write plan artifacts to the resolved storage_root.
- Every new task plan must emit explicit routing metadata for /run-plan: risk_tier (low, medium, high), review_lane (verify-local, codex-bridge, operator-gate), review_lane_rationale, and optional escalation_triggers.
- When the task has a linked Dart task ID: build a Dart planning breadcrumb using buildWritebackPayload() from tools/signals/lib/client-board-triage.js with plan context (artifact_path, framework, next_gate, run_command), present the comment for operator confirmation, then post it to the Dart task.
- In the Dart writeback breadcrumb, propose the task's shape from this vocabulary: remain a Brief / become subtasks / Owner-Summary tree / clarification. Choose 'Owner-Summary tree' for multi-person client deliverables (2+ contributors, or 1 contributor with a distinct owner/stakeholder audience) that warrant the 3-level owner_summary -> for_grouping -> implementation workspace built by tools/dart-integration/create-tasks-from-workspace.js. This is REVIEW_ONLY — propose the shape, do not create the tree.
- If Dart MCP is not available, include the proposed comment in the plan artifact for manual posting.
</process>

<success_criteria>
- Framework similarity assessment completed, including task_patterns and broadening_recommendation review
- Existing-work overlap check run (check-existing-work.js); owning-plan overlap and recent background-track activity surfaced, with /amend-plan preferred on a strong owning match
- Bounded plan generated with covered steps, gap steps, gates, and risk notes
- Routing metadata (risk_tier, review_lane, escalation_triggers) included in plan
- Plan artifacts written to the scope-appropriate storage root (clients/{CODE}/plans/ for client scope, _dev/reports/analysis/task-plans/ for system scope)
- Plan is proposed only — no execution attempted
- Dart breadcrumb posted or included in artifact when a Dart task is linked
- Trace context propagated to the planning session
</success_criteria>

<handoff>
plan_approved: /run-plan <task-id>
plan_needs_review: /review-task-plan <task-id>
no_framework_match: Operator decides whether to proceed without framework or create a new one
</handoff>
