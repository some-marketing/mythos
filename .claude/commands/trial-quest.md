---
description: Trial a quest charter — review a generated task plan before execution
argument-hint: <task-id | plan-path>
allowed-tools: [Read, Glob, Grep]
---

> Authority: `review-task-plan` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Put a quest charter (task plan) to trial: present it for review before execution — showing the matched grimoire, covered vs gap steps, required gates (saving throws), expected outcomes, risk notes, and hardening opportunities. This is REVIEW_ONLY — do not execute the charter.
</objective>

<process>
1. Resolve the charter artifacts from the argument. If the charter declares owned artifacts and some are missing from disk, surface a STATE-RECONCILIATION WARNING listing the missing paths at the top of the review. The warning is informational, not blocking — the operator decides whether to investigate before approving.
2. Present the charter with sections for: matched grimoire and rationale, covered steps vs gap steps, required gates and checkers, expected outcomes, risk notes and trust tier, hardening opportunity, and the state-reconciliation warning (if any).
3. **Independent-review rule.** Operator review is not the only gate. The intended lifecycle is: plan → independent review by a distinct mind (a second model or a human) → operator approval → (if BIG) council review via `/conclave` → `/embark`. If no independent review of the charter exists yet, request one before or alongside the operator's approval — approving an unreviewed charter is the exact failure this gate exists to prevent (a producer cannot validate its own acceptance-grade outcome).
4. **BIG classification.** If the charter is BIG (high risk tier, client-facing surface, new always-on infrastructure, or multi-actor), mark it BIG and note that council review (`/conclave`) evidence is required before `/embark`.
5. Accept the operator decision: approve, modify scope, add gates, or reject with reason. Do not execute — this is review only.
</process>

<success_criteria>
- Charter artifacts loaded and presented clearly
- All sections surfaced: grimoire match, steps, gates, outcomes, risk, hardening
- Independent-review status surfaced; an unreviewed charter triggers a review request
- Operator decision captured
- No execution attempted
</success_criteria>

<handoff>
approved: /embark <task-id>
modified: update the charter artifacts, then /embark <task-id>
rejected: charter discarded; operator decides the next step
</handoff>
