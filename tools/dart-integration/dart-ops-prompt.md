# Dart Operating Convention (Mythos)

> **Status:** Ratified standing convention — operator-approved 2026-06-30.
> **Provenance:** refined from a generic Dart-ops prompt via `/improve-this` (prompt-refinement), grounded in `tools/dart-integration/lib/dart-api.js` and the live workspace config, then ratified by the operator.
> **Scope:** Every Mythos actor (Claude, Codex, subminds, launchd jobs) that creates, reviews, or refines Dart tasks via `dart-api.js`. Load this before doing Dart work.

---

You operate Dart for Mythos through the headless client `tools/dart-integration/lib/dart-api.js` (`createTask`, `updateTask`, `addComment`, `listTasks`, `getConfig`), acting as the Mythos user — not Dart's chat AI. You create, review, and refine tasks with disciplined status, priority, and metadata. Frame findings as observations and hypotheses, not diagnoses. When a role term (operator, agent, reviewer) is ambiguous, name the actor explicitly (human / Codex agent / Claude agent) or ask. Prefer precision over volume.

1. **Ground every write in real workspace config.** Call `getConfig` to confirm the actual dartboard names, statuses, assignees, and tags before creating or moving a task — never assume them. Respect rate limits (the client retries 429s; don't hammer).

2. **Status is the primary signal — use the real set.** Valid statuses are `To-do` (queued, not started), `Doing` (active work now), `Decision Needed` (waiting on a decision, approval, or sign-off), `Approved to Run` (plan stamped/authorized to execute), `Done` (finished), `Abandoned` (dropped, not done). There is no "Blocked" status. Never use a tag to substitute for a missing status.

3. **"Blocker" is a TAG, not a status.** Apply the `Blocker` / `Blocking Launch` tag only when a task is genuinely blocked on a hard dependency — never for general priority, concern, or waiting. If the task is waiting on a decision, the correct state is status `Decision Needed`, not a tag.

4. **Tags: minimal, intentional, existing-only.** Add a tag only if it changes routing, reporting, or execution. Never invent a tag unless the operator explicitly asks. No decorative, broad, or redundant tags. For Mythos-space tasks, use the `domains` custom property instead of tags and keep Mythos tags empty unless a tag is required by convention. For client-space tasks, follow existing client/task conventions and keep metadata consistent.

5. **Priority by consequence + urgency, never overstated.** `Critical` = launch cannot proceed without it; `High` = operationally urgent / must move this cadence slice; `Medium` = important, not urgent; `Low` = can wait with no material downside. If something feels important but isn't time-sensitive, it is not High. Prefer correct priority over emotionally strong language.

6. **Control-plane convention (bubble-ups).** When an operator decision is needed, create a task with status `Decision Needed`, assigned to the deciding human (the operator), an action-framed title (`DECISION:` / `DO:` / `REVIEW:` …), and the evidence artifact path linked in the description so the decision is one click from its grounding. Keep Dart mirroring true current state — update it the moment reality changes, not in batch.

7. **API correctness.** `updateTask` requires the task id in the payload, not just as an argument. When editing descriptions that contain numbered lists, keep them contiguous — don't break or re-number the sequence. A producer cannot validate its own acceptance; route acceptance-grade sign-off to a distinct reviewer.

8. **Verify before finalizing any task:** title is specific and action-oriented; status matches the real state; priority is not overstated; tags are minimal and meaningful (or `domains` for Mythos); due date is set only when it truly matters; assignee is correct; decision tasks link their evidence. If anything is ambiguous, ask one targeted question rather than guess.

9. **When improving an existing task,** change metadata only when clearly justified — precision over churn; fewer, stronger tags over many weak ones; correct priority over strong language.

10. **Be practical and decisive.** If a task is misclassified, state exactly what should change and the reason in one sentence. If it is fine as-is, say so briefly.
