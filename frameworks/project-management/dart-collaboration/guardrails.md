# Dart Collaboration Framework — Guardrails

## Execution Modes

| Mode | When | Constraints |
|------|------|-------------|
| REVIEW_ONLY | Auditing board state, analyzing index.json, comparing Dart vs git | No Dart mutations, no file writes except analysis reports |
| PATCH_ALLOWED | Creating tasks, updating index.json, adding context files | Dart task creation requires user confirmation before `create_task` call |

## Safety Rules

1. **Never create a Dart task without user confirmation.** Always present the generated title and description for approval before calling `create_task`.
2. **Never delete Dart tasks.** Use status changes (Done) or comments instead.
3. **Never modify task descriptions without confirmation.** Present the diff and wait for approval.
4. **Never expose email addresses in task descriptions.** Use display names only.
5. **Observational reporting for audits.** When comparing Dart board state to index.json, report discrepancies as observations, not prescriptions.

## Task Creation Rules

1. Use the appropriate task type template from `docs/TASK_TYPES.md`.
2. If unsure which type to use, default to **Brief** for parent-level tasks and **Implementation** for child-level tasks.
3. Always include the `**Context:**` footer when a workspace context file exists.
4. Assign to the first responder, not the eventual implementer (for Briefs).
5. Set status to "Decision Needed" only for Design Decision tasks.

## Intake Triage Rules

1. Open and unworked is not sufficient for pickup. Client-board items must be triaged before claim.
2. Classify every intake item into exactly one of: `pick_up_now`, `plan_first`, `needs_clarification`, `update_existing`, `blocked`, `ignore`.
3. Only `pick_up_now` items are safe for immediate robot pickup. `plan_first` items are real work but require a bounded plan before claim or execution.
4. If a task overlaps an active repo workstream or another Dart task, update or link the existing lane instead of creating a duplicate.
5. If critical context is missing or a stakeholder decision is unresolved, keep the item in clarification or blocker state rather than guessing.

## Recursive Triage Kernel

1. Express every Dart intake item as **Current State → Question / Work → Desired State** before creating or updating a task.
2. The **Question / Work** field is the one central question the task exists to answer. If there are multiple central questions, split before creating implementation work.
3. If there is one safe next step, execute or route it inside the current authority scope instead of asking for operator confirmation.
4. If a safe binary choice appears, default to yes and record the decision. If three options include "do both," treat "do both" as the single effective answer.
5. If more than three peer questions or steps appear, create child tasks when they share the same desired state, or sibling tasks when they represent different desired states.
6. Questions should resolve at the lowest possible task level. Bubble up only questions requiring human judgment, approval, scope/budget/timeline commitment, client-facing risk acceptance, destructive or irreversible action, credential access, or same-rank authority conflict.
7. Child task results bubble up as answer, resulting state, and parent impact.

## Workspace Linking Rules

1. Context files in git are living documents — append decisions, don't rewrite history.
2. Evidence files are immutable snapshots from a specific audit round.
3. When updating `index.json`, preserve all existing fields. Only add new fields or update `type`/`verdict`/`status`.
4. Never remove entries from `index.json` — tasks may be archived but their history matters.

## Column Movement Rules

1. **Done is terminal.** Never move a task out of Done. If rework is needed, create a new task referencing the original.
2. **Reverse movements require documentation.** When moving a task backwards (Review -> In Progress, In Progress -> Decision Needed), edit the task description to explain why.
3. **Parent column is derived.** Parent task column reflects children's collective state. Do not move a parent independently unless documenting an override reason in the description.
4. **Evidence before Done.** A task cannot be moved to Done unless its `**Evidence:**` footer is populated with a commit URL or artifact link.
5. **Brief-to-parent transition.** A Brief moves from Proposed to In Progress only when the first subtask is created. All Open Questions must be resolved first.
6. **Design Decisions enter at Decision Needed.** Design Decision tasks are created with status "Decision Needed" regardless of whether they are standalone or children of a Brief.

## Linked Task Writeback Rules

1. When planning starts from a Dart task, the planning artifacts must include a proposed writeback payload naming the matched framework, summary, and next gate.
2. Execution updates belong in comments as operational breadcrumbs, blockers, and handoffs.
3. Closeout must update the `**Evidence:**` footer before the task moves to Done.
4. Dart reflects active-work state; repo artifacts remain the technical source of truth.

## Dart Skill Constraint

The Dart MCP API provides `retrieve_skill_by_title` (read-only). Skills cannot be created or updated via API. The framework produces ready-to-paste markdown files (`templates/dart-skill.md` for client boards, `templates/mythos-dart-skill.md` for the Mythos board) that must be manually pasted into Dart workspace settings.
