---
description: Gauntlet — a high-rigor profile of the guildmaster loop with distinct-family review, a context check, and research-resolved findings
argument-hint: <target> [--dry-run]
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `evidence-loop` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Run the gauntlet: a high-rigor profile of `/guildmaster-loop` for plans, implementations, audits, and deliverables that warrant explicit, research-resolved cross-verification. The gauntlet adds no independent lifecycle state — the Guildmaster loop remains the sole controller and owns target resolution, execution routing, review ceilings, termination, debrief, and closeout. The gauntlet adds three things on top: an adversarial review by a distinct mind, a context check by a third distinct mind, and a research disposition for every finding.
</objective>

<process>
1. **Profile entry.** Resolve the target, authority, current loop state, risk tier, and review ceiling through `/guildmaster-loop`. Do not create a second state machine, iteration counter, or closeout path.
2. **Anti-ceremony exit.** If the target is repo hygiene, review-only, or one safe deterministic step with no consequential claim, ambiguity, or privacy/security/compliance surface, record why the gauntlet is unnecessary and continue through the ordinary loop.
3. **Candidate.** Produce the candidate through a bounded worker when work is required. The coordinator is not the default worker.
4. **Adversarial review.** Dispatch an acceptance reviewer from a family distinct from the producer — a different model, or a human. Disclose which mind reviews at dispatch time. The producer cannot close its own acceptance-grade finding.
5. **Context check.** While the profile is active, dispatch a third mind, distinct from both producer and reviewer, to check omissions, downstream consequences, stale context, and cross-domain assumptions. Web research never counts as this reviewer.
6. **Finding ledger.** Record every returned finding durably. Each finding carries: id, severity, producer family, reviewer family, context family (when required), evidence, research disposition, sources or query artifact when applicable, answer, next action, status, iteration count, and supersession links.
7. **Research disposition.** Assign each finding exactly one: internal_evidence, public_web, private_prohibited, operator_only, superseded, or blocked.
8. **Research resolution.** internal_evidence uses repo truth, tests, or direct source and makes zero web calls. public_web uses cited web research only after the query is checked for privacy leakage. private_prohibited fails closed before any query is built and is never generalized into a web search to satisfy the ritual. operator_only bubbles up only after answerable evidence is attached. superseded and blocked stay durable.
9. **Synthesis.** Synthesize review, context, and research evidence — the research substrate informs findings but never counts as a reviewer vote. Route repairs, evidence collection, amendment, execution, or operator decisions through the native command the Guildmaster loop owns.
10. **Re-entry.** Return the ledger to `/guildmaster-loop` and inherit its states and ceilings exactly (low 3, medium 4, high 5 by default). Clean maps to ready_for_clear; missing evidence to evidence_missing; drift to plan_diverged; ceiling exhaustion to the review-ceiling state; protected human decisions to blocked.
11. **Closeout.** Meaningful work closes through `/chronicle` and a truthful status note under the Guildmaster loop's ownership. Findings are never deleted to manufacture a clean result — supersession preserves provenance.
</process>

<success_criteria>
- Target and authority resolved by the Guildmaster loop before profile work
- No parallel loop state, counter, or closeout authority introduced
- Producer, acceptance reviewer, and required context checker are family-distinct
- Every finding has one validated research disposition
- Internal findings make zero web calls; private-prohibited findings fail closed before any query is built
- Web research informs findings but never counts as reviewer approval
- Review ceilings and exit states are inherited from the Guildmaster loop
- Superseded findings stay durably linked rather than deleted
</success_criteria>

<handoff>
profile_unnecessary: /guildmaster-loop <target>
review_needed: request an adversarial review from a distinct-family reviewer
context_needed: request a bounded omission/consequence check from a third distinct mind
reenter: /guildmaster-loop <target>
ready_for_clear: /chronicle <target>, then close out or emit the next stage command
</handoff>
