---
title: Simulation scale and boundary doctrine
authored: 2026-08-03
status: mixed — section 2 proposal; section 3 documentation without authority; section 4 operator decisions
audience: external reader with no access to internal sessions, runbooks, or infrastructure
---

# Simulation scale and boundary doctrine

This document states the structural doctrine governing multi-scale minds in an
agent simulation, and the vocabulary that decides when an autonomous process must stop and
consult a human.

**It is written for a reader who has none of the surrounding context.** Every claim below is
either self-contained or points at a repository file that reader can open. It deliberately
contains no operational, infrastructure, or deployment detail, because none of that is needed
to evaluate the ideas — and because three reviews by a reviewer independent of the producer
established that internal working records could not be made publishable by editing them. This
is a new statement of the doctrine, not a redaction of those records.

**Status is mixed, and each section says which it is.** Section 2 is a proposal. Section 3
documents an existing pattern and claims no authority. Section 4 records decisions already
made by the project's operator, dated.

---

## 1. The problem: minds at more than one scale

A simulation with agents at a single scale needs no scale doctrine. The moment a second tier
exists — agents that coordinate agents — three questions appear immediately, and answering
them by intuition produces a system whose behaviour nobody can predict:

1. Does an upper-tier mind hold **authority** over lower-tier minds, or only **carriage**?
2. Is an upper-tier mind a **distinct family** for review purposes?
3. When a new tier is activated, who decides?

The concrete case that forced these: a proposal for a **solar-system-scoped mind** sitting
above planetary minds, positioned at the star, serving as the communication point between the
planets and the wider cosmos. That adds a tier — planetary, then stellar, then cosmic — and a
ladder that in principle continues upward.

## 2. Carriage, not authority

**Proposed ruling: an upper-tier mind relays; it does not govern.**

The stellar mind routes inter-planetary messages and is the sole uplink to the layer above it.
It holds **no power to approve, veto, validate, or override** any lower-tier mind's action.

The reason is not modesty about upper tiers — it is that carriage and authority have different
failure modes, and conflating them makes the system's behaviour unanalysable. A relay that
also adjudicates cannot be audited for transport fidelity, because every message it drops has
two possible explanations. Keeping the split sharp means a transport failure and a governance
decision are distinguishable after the fact, which is the property you need when something
goes wrong.

This generalizes past this simulation. Any tier that both carries and decides will eventually
be asked to explain an outcome it cannot decompose.

## 3. Tick, turn, and checkpoint

A separate question governs when a machine stops and asks a human. The vocabulary below
distinguishes autonomous progression, human-facing interaction, escalation from autonomy, and
actions that have no autonomous form.

- **Tick** — a unit of autonomous progression. No human input by design.
- **Turn** — a human-facing interaction boundary. By design, waiting on or presenting to a
  person.
- **Checkpoint (escalation)** — the named condition set under which a tick *already in
  progress* must stop and become a turn. A checkpoint presupposes an autonomous form to
  escalate *from*.
- **Operator-exclusive action** — a class of action with no autonomous form at all. It is
  never on the tick side of the boundary, so it is not a checkpoint; there is nothing to
  escalate from.

### What this vocabulary is not for

**Invariants are not checkpoints.** A rule with no fire/no-fire state — a membrane that
nothing may legitimately cross — is not a condition that escalates. It is a boundary that
holds. Treating an invariant as a checkpoint invites the question "under what conditions do we
cross it?", which is precisely the question an invariant exists to foreclose.

**Advisory framing is not authority.** A heuristic that classifies work by complexity to
suggest an approach is guidance. Naming it in the same vocabulary as an enforced gate makes
guidance look mechanical, and mechanism look optional.

### Why name an existing pattern

This vocabulary creates no new mechanism, gate, or authority. It names a pattern already
present in several unrelated parts of a codebase. That is the entire value: before it existed,
the same escalation criteria had been independently expressed in at least two places, which
means they could drift apart without anyone noticing. A shared name makes divergence visible.

The generalizable claim: **when the same condition is expressed twice in different words, the
system has two rules, not one** — and it will eventually behave as though it does.

## 4. Decided by the project's operator

Three decisions on record, with their reasoning:

**Tier activation is consulted per rung (2026-08-02).** A human approves the *first* activation
at each genuinely new ladder height, rather than every activation or none. The reasoning: a new
rung is novel by definition, and novelty is where judgement is needed; the second activation at
a height already approved is not. Explicitly reversible — the condition set is an artifact, and
it can be tightened to always-consult by a single later ruling.

**Tier validation is bounded-family (2026-08-02).** A tier is validated against a bounded
family of constituent behaviours rather than against one particular learned mind, on a
durable-over-cheap rationale.

**Abstract structure may be tracked; world content may not (2026-08-02).** Structural doctrine —
scale tiers, carriage/authority splits, vocabulary, invariants — may live in tracked
repository paths. World-specific content — lore, character identities, narrative canon — does
not. **And every move of tracked material to a new destination requires a fresh review of that
destination by a party that did not produce it.** This document exists because that rule was
applied and produced three rejections.

## 5. A producer never validates its own trial

The rule under which this document was written, and the reason it exists in this form.

The mind that produced a thing is never the mind that judges whether it is good — not as
etiquette, but because a producer checking its own output tends to see what it *meant* to
write rather than what it wrote. If a producer's own claim of success were sufficient, review
would have no reason to exist.

This applied here with some force. The internal records of this work were proposed for
publication three times, in three different forms, and rejected three times by an independent
reviewer. Each rejection was correct. The producer asserted a wrong publication boundary on
every attempt. The lesson recorded is not "sanitize more carefully" — it is that documents
written for a reader with privileged context assume that context *structurally*, and no amount
of editing removes an assumption that load-bearing. The correct response was to write
something new, for the actual audience, which is what this is.

## 6. What is deliberately absent

No infrastructure, host, deployment, or network detail. No operational procedure. No session or
branch identifiers. No client or engagement identifiers. No world-specific content. None of it
is necessary to evaluate the doctrine, and its absence is the point rather than a gap.

Where this document refers to internal decisions, it states the decision and its reasoning
rather than citing a record an external reader cannot open. Claims that would rest solely on
such records have been omitted, not footnoted.

## 7. Status and how to disagree with this

Everything in section 2 is a **proposal**, not a ruling. Section 3 is documentation of an
existing pattern and claims no authority. Section 4 records decisions already made.

The most useful disagreement would be with section 2: if an upper-tier mind should hold
authority, the argument would need to explain how transport failures and governance decisions
remain distinguishable afterward. That is the property the carriage-only split is protecting,
and any alternative has to protect it another way.
