---
description: Plan a quest — compare a task to hardened grimoires and propose a bounded, review-gated charter
argument-hint: <task> (--client CODE | --scope system)
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

> Authority: `plan-task` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Plan a quest: compare a task to the hardened grimoires (frameworks), present the top matches, and generate a bounded quest charter (task plan) with routing metadata. This is REVIEW_ONLY — propose the charter, do not execute it.
</objective>

<process>
1. **Assess grimoire similarity.** Compare the task to registered grimoires and to broader workflow patterns. Present scored top matches and pattern matches as separate classes of evidence. Pattern matches widen inspection; they do not fabricate certainty or override stronger contradictory evidence.
2. **Check for existing work.** Detect any existing quest charter that overlaps this scope. If a strong owning charter exists, PREFER amending it over authoring a parallel one — authoring a new charter despite a strong match requires an explicit reason.
3. **Declare scope explicitly.** If the task is patron-delivery work, scope is `client` and the charter is stored under that patron's `clients/{CODE}/plans/`. If it is grimoire, runtime, or cross-patron system work, scope is `system` and stored under `_dev/reports/analysis/task-plans/`. Ambiguous scope must block — do not default silently. If neither `--client CODE` nor an explicit system-scope declaration is present, ask the operator to clarify.
4. **Generate the bounded charter:** covered steps, gap steps, gates (saving throws), and risk notes.
5. **Emit routing metadata** for `/embark`: `risk_tier` (low/medium/high), `review_lane` (verify-local / independent-review / operator-gate), a rationale, and any escalation triggers.
6. Write the charter artifacts (JSON + matching markdown summary) to the scope-appropriate plans root (`clients/{CODE}/plans/` for patron scope, `_dev/reports/analysis/task-plans/` for system scope).
7. This is REVIEW_ONLY — propose the charter only; attempt no execution.
</process>

<success_criteria>
- Grimoire similarity assessment completed, including pattern-match review
- Existing-work overlap surfaced, with amendment preferred on a strong owning match
- Explicit scope declared (patron vs system); ambiguous scope blocks
- Bounded charter generated with covered steps, gap steps, gates, and risk notes
- Routing metadata (risk_tier, review_lane, escalation triggers) included
- Charter artifacts written to the scope-appropriate plans root
- Charter is proposed only — no execution attempted
</success_criteria>

<handoff>
plan_approved: /embark <task-id>
plan_needs_review: /trial-quest <task-id>
no_grimoire_match: operator decides whether to proceed without a grimoire or forge a new one
</handoff>
