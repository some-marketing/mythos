---
description: Commune — the fixed deliberation ritual: reason solo, council review, synthesize, then route through the guildmaster loop
argument-hint: <task | question | plan-path>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `deliberate` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Commune runs the full high-rigor deliberation pattern on demand: (1) reason on your own and write that reasoning down, (2) convene a council (`/conclave`) to review it, (3) synthesize one voice that names disagreement, (4) route the synthesis back through the ordinary Guildmaster loop (`/guildmaster-loop`). In plain terms: it is a composition wrapper over the council-review and orchestration commands — it adds no new authority or permission model. Typing `/commune` IS the opt-in to the ritual; the ordinary loop stays anti-ceremony for routine work.
</objective>

<process>
1. Treat commune as a wrapper over `/conclave` and `/guildmaster-loop`, not an independent contract.
2. **Stage 1 — reason solo.** Normalize the request into the task kernel (Current State, Question / Work, Desired State). Write your own reasoning, the candidate routes, and the consequential assumptions down before any council fires. This is the raw signal the council reviews — do not skip it or collapse it into a conclusion.
3. **Early-exit check.** If the resolved Question / Work is a single safe deterministic step with no judgment, source-change, ambiguity, or disagreement surface, say so plainly, skip to Stage 4, and route directly through `/guildmaster-loop`. Do not convene by ceremony.
4. **Stage 2 — council review.** Run `/conclave <task>` with the Stage 1 reasoning attached as context. The council gathers two or three independent reviewers (distinct models, or a human) in parallel and returns their written responses.
5. **Stage 3 — synthesize one voice.** Fold your own analysis and the council's responses into one position. Name disagreements and unresolved tensions explicitly rather than smoothing them — held contradiction is the honest state; forced resolution is the failure mode.
6. **Stage 4 — route.** Hand the synthesis to `/guildmaster-loop <target>` so orchestration owns target resolution, fractalization, evidence gates, review classification, and closeout. Bubble up to the human operator only judgment/approval/destructive/credential/budget/authority-conflict questions.
7. When review findings return, classify them by severity and type using the Guildmaster loop's review decision tree. CRITICAL/MAJOR blockers stop downstream advancement until durably deferred.
8. Close meaningful multi-step work with `/chronicle` and a truthful status note; closeout follows the Guildmaster loop's ownership rule.
</process>

<success_criteria>
- Solo reasoning is written down before the council fires
- The council step runs unless the target is a single safe deterministic step (skip reason stated)
- Synthesis exists as one voice and names disagreements explicitly
- Final routing goes through `/guildmaster-loop`, not a duplicate workflow
- Only human-judgment or protected-approval questions bubble up
- No new permission model or actor role is introduced
</success_criteria>

<handoff>
ritual_warranted: Stage 1 reason solo, then /conclave <task>, then /guildmaster-loop <synthesis-or-target>
single_safe_step: /guildmaster-loop <target>
ready_for_clear: /chronicle <target>, then close out or emit the next stage command
</handoff>
