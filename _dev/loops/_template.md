# [Domain Name] Self-Improving Cascade — Loop Charter

> STATUS: DRAFT v1 — authored [date]. [Note any prior review/rejection history and
> what changed, once one exists. A charter touching a sensitive or irreversible domain
> should say here whether it is GOVERNANCE-gated — not "live" until the operator
> promotes it.]

**What this is:** the durable charter for a self-improving loop over **[bounded
domain]**. It is the *definition*, not the driver. Drive it by repeatedly invoking
`/guildmaster-loop` (orchestrate-loop) against it, once per iteration. Each iteration
rebuilds state from durable artifacts ([name your state sources: an external tracker,
live signals, git, domain-specific descriptors]) — never from chat memory.

**How to run it** (paste in the prompt window, once per iteration):

```
/guildmaster-loop Run the next iteration of the [domain] improve loop, per the charter
at _dev/loops/[this-file].md. Rebuild state from [state sources] first; respect every
gate in the charter; stop when the charter's STOP condition is met.
```

---

GOAL: [Advance <domain> one bounded unit at a time], AND build the control-plane
substrate ([tracker] state + durable multi-mind grade records + structured improvement
proposals) that lets the system autonomously improve **only the [declared safe layer]**
of the domain on evidence, while every [declared unsafe layer] change routes to the
operator. Run each unit through `/guildmaster-loop`. Grade every output with a distinct
mind (producer ≠ validator). Cascade down to execute, bubble up to improve, repeat
until the actionable surface is drained and no improvement is queued.

SCOPE: [Name the exact bounded domain this charter governs, and what it explicitly does
NOT authorize.]

---

## THE AUTONOMY LADDER (classify by what a change can DO, not by filename)

The governing question for every change: **can this change convert a blocked/unknown/
fail state into a pass/draft-ready/actionable state?** If yes, it is at minimum
GOVERNANCE-gated.

### Layer 0 — AUTONOMOUS to DRAFT (on convergent distinct-mind grade)
[Name the purely evaluative/generative changes that cannot relax any gate — content
that lands in draft-only outputs.]

### Layer 1 — GOVERNANCE-gated → `/charter-quest` (operator plan-gate)
[Name the enforcement surface: pass/fail criteria, evidence-field requirements,
allowlists, this charter itself, shared system/kernel surfaces. No self-amendment.]

### Layer 2 — OPERATOR-GATED (money/live/irreversible/host-bound)
[Name anything requiring a live host mutation, secret, external publish, or genuinely
irreversible action. Staged/dry-run only until greenlit.]

### Cross-cutting HARD gates (apply at every layer, no autonomous override)
- **RATCHET:** any change converting a previous fail/blocked/unknown to pass/draft-ready
  is gated; gate-*tightening* may be autonomous to DRAFT.
- **MIXED = fully tainted:** if a change reaches into a higher layer, the whole change
  escalates — no surgical self-splitting of a mixed proposal.
- **CLASSIFICATION BY NON-PRODUCER:** the layer assignment of any change is made by a
  mind other than the one that produced it. Ambiguity escalates.

---

## [Any domain-specific hard tripwires — name them explicitly if this domain has them.
Delete this section if the domain has none; do not leave a fake example in a real
charter.]

---

## MIND ROUTING (disclose the model at every dispatch; tier to work altitude)

- [Public-research mind] — PUBLIC web research ONLY. Never private substrate or PII.
- [Local/private-read mind] — private or sensitive substrate reads.
- [Build/verification mind] — repo truth, executable constraints, falsification.
- [Hardest-reasoning mind, distinct family from the producer] — reserve for the hardest
  legs only; do not spend it on mechanical work.
- Convene (multi-mind council) — the deliberation + grading engine for acceptance-grade
  units.
- Mechanical orient/recon — small local tooling, off the frontier main chain.

---

## THE CONTROL PLANE (mirrored at produce-time)

Orient: read the domain's work queue; claim the unit. Cascade: keep it in-progress; log
each dispatch + disclosed model. Grade: attach the multi-mind grade record + evidence.
Improve: file improvement units linked to the surfacing unit; every gated decision
becomes an explicit "decision needed" record for the operator. Close: mark done with
evidence; update domain state as the record of truth. The tracker (or equivalent
durable state) is the source of truth, not chat memory.

---

## EACH ITERATION

0. **ORIENT** (mechanical, cheap, off the frontier chain): rebuild state from durable
   artifacts; reconcile against all remotes + the signal surface; pull the domain
   surface; pick ONE highest-leverage unblocked unit and claim it. Nothing actionable →
   step 3 or rest.
1. **CASCADE DOWN:** tier + disclose each mind; the coordinator never executes on the
   main chain — delegate every leaf; produce at the correct layer.
2. **GRADE — distinct minds, producer ≠ validator:** grade every unit before it queues
   further. Convergence needs an operational falsifier — a named failure classifier and
   at least one distinct-family mind, not a same-family majority.
3. **BUBBLE UP + IMPROVE** — routed by the ladder above. Layer 0 → autonomous to DRAFT
   on convergent grade. Layer 1 → `/charter-quest`. Layer 2 + hard gates → operator.
   MIXED → escalate whole.
4. **CLOSE:** durable evidence (`/chronicle`, a signal, or a next-session handoff);
   mark the unit done; truthful signals only.

## STOP + INTERRUPTABILITY

STOP when the actionable surface is drained AND no improvement is queued AND no
unresolved operator gate needs surfacing. ALSO halt immediately on: any gate-
classification uncertainty that cannot be resolved fail-closed, any domain-specific
hard-tripwire trip, or an iteration cap. Report state and end. The operator can
interrupt at any point; the loop must be killable between every leaf.

---

This loop is the operator's scoped lift for [domain]'s Layer-0 work only. It does NOT
authorize [name what's explicitly out of scope], unrelated system work, or canonical
pushes.
