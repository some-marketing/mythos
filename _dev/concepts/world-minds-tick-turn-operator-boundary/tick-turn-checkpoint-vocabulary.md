---
title: Tick / turn / checkpoint vocabulary
identified: 2026-08-01
context: G3 of world-minds-tick-turn-operator-boundary quest charter
status: documentation only — no canonical authority, describes existing mechanisms
---

# Tick / turn / checkpoint vocabulary

This document names an existing pattern already present across several unrelated parts of the repo. It does not create a new mechanism, gate, or authority. If any statement here conflicts with the actual behavior of a cited file, the file is correct and this document is stale — update it, don't treat it as the authority.

## Definitions

Three categories, not two (corrected after G6 distinct-family review found the original two-category version silently redefined "checkpoint" to force a fit — see `context/g2-falsification-test.md`, Test 5):

- **Tick** — a unit of autonomous progression. No operator input by design. Example: `/new-session`'s auto-commit and disk-quota-guard steps, observed this session running and completing with no operator turn.
- **Turn** — an operator-facing interaction boundary. By design, waiting on or presenting to the operator. Example: the ConveneReceipt gate's fail-closed block, or an `AskUserQuestion` call.
- **Checkpoint (escalation)** — the named condition set under which a tick *already in progress* must stop and escalate to a turn. Requires an autonomous starting state that the condition interrupts. Example: the ConveneReceipt gate (observed firing this session); the destructive-git-command confirmation habit (policy-documented, not yet observed firing in this session).
- **Operator-exclusive action** — a class of action with no autonomous form to escalate from in the first place; it is never on the tick side of the boundary. Not a checkpoint, because there is nothing to interrupt. Example: the custody-grant quarantine-release entry point (`tools/kernel/hooks/lib/custody-grant-txn.cjs`) — never AI-executable, never allowlisted, by design, with no tick-form equivalent.

## What this vocabulary is NOT for

- **Invariants are not checkpoints.** The membrane law (`instructions/canonical/kernel/doctrine.md:42-51`) has no fire/no-fire state — nothing legitimately approaches that boundary except one pre-authorized channel. Don't describe an invariant prohibition as "a checkpoint that always escalates" — it isn't a gate with two states, it's a standing constraint. See G2's negative-control test for why this distinction matters.
- **Advisory framing is not canonical authority.** The TRIVIAL/BOUNDED/NOVEL altitude classification (`tools/kernel/hooks/userprompt-owl-altitude.cjs`) shapes how work gets sized, but its own text says "advisory framing, not a new authority." The canonical checkpoint criteria live at `instructions/canonical/commands/orchestrate-loop.yaml:21`. `.claude/skills/bp-r/SKILL.md:22-28,50-60` echoes a near-identical list, but as a project-space skill surface it carries no canonical authority of its own — if it ever diverged from `orchestrate-loop.yaml`, the canonical file would be correct, per the alias-authority law.

## Where this maps onto existing surfaces (per G1's inventory)

| Surface | Type | Fires as | Evidence this session |
|---|---|---|---|
| Execution modes (`system.yaml:111-140`) | canonical rule | per-action tick/turn boundary (FINDINGS_ONLY/REVIEW_ONLY = analysis tick only; PATCH_ALLOWED = scoped write tick; COORDINATOR = delegated) | policy-documented |
| Orchestrate-loop bubble-up criteria (`orchestrate-loop.yaml:21`) | canonical rule | checkpoint (escalation) | policy-documented |
| bp-r operator-only triage (`SKILL.md:22-28,50-60`) | instructional/skill surface (not canonical) | same checkpoint criteria, echoed at skill layer | policy-documented |
| HarnessCapabilityPolicy (`harness-capability-policy.yaml:2-37`) | canonical rule | checkpoint (escalation) for 4 of 5 propagation classes; `command_surfaces` is `auto_apply:false` only, routed to a named mechanical repair instead | policy-documented |
| ConveneReceipt gate (`pre-write-convene-required.cjs`) | executable gate | checkpoint (escalation), mechanically enforced (fail-closed) | **observed firing twice, this session** |
| Custody-grant release firewall (`custody-grant-txn.cjs`) | executable gate | operator-exclusive action (no tick-form exists) | policy-documented (README citation supports human-only/targeted-only/never-allowlisted; an "immutable receipt" detail in earlier drafts was unverified and removed) |
| Session boundary-crossing (`consume-boundary.cjs`, `/new-session`, `/shutdown`) | executable + advisory | turn-boundary mechanism, already scoped and in production use | policy-documented |
| Auto-commit / disk-quota-guard at session start | executable | tick (autonomous, no escalation, gated by its own kill-switch design) | **observed running, this session** |
| Membrane law (`doctrine.md:42-51`) | canonical rule | **not in this vocabulary at all** — invariant, no fire/no-fire state | negative control, confirmed sound |

## Why this exists

Before this document, the same checkpoint criteria were independently expressed at least twice (orchestrate-loop.yaml and bp-r's SKILL.md), and one advisory hook's framing was easy to mistake for canonical authority (a mistake this charter's own first draft made — see G1's correction). Naming the pattern once, with an explicit map to where it already lives, reduces that drift risk. This document does not change any of the cited mechanisms' behavior.
