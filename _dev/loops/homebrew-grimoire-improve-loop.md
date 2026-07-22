# Caravan Quartermaster Homebrew Grimoire Improve Loop — Loop Charter

> STATUS: FICTIONAL WORKED EXAMPLE. Nothing in this file describes a real grimoire,
> patron, or event. It exists only to show all five load-bearing properties from
> `README.md` applied to one concrete, invented domain: improving a homebrew grimoire
> from its own run evidence. Copy the *shape*, not the specifics.

**What this is:** the durable charter for a self-improving loop over **Caravan
Quartermaster** — an invented homebrew grimoire (`frameworks/homebrew/caravan-quartermaster/`)
that drafts cargo manifests and expense summaries for a fictional trading caravan. It is
the *definition*, not the driver. Drive it by repeatedly invoking `/guildmaster-loop`
(orchestrate-loop) against it, once per iteration. Each iteration rebuilds state from
durable artifacts (this charter's own state file, live signals under
`_dev/reports/signals/`, and git) — never from chat memory.

**How to run it** (paste in the prompt window, once per iteration):

```
/guildmaster-loop Run the next iteration of the Caravan Quartermaster improve loop, per
the charter at _dev/loops/homebrew-grimoire-improve-loop.md. Rebuild state from
_dev/reports/signals and git first; respect every gate in the charter; stop when the
charter's STOP condition is met.
```

---

GOAL: Advance Caravan Quartermaster's cargo-manifest and expense-summary drafting one
bounded unit at a time, using real run evidence (spoils captured from actual manifest
drafts) to find and fix gaps in the grimoire's own prompts and templates. Build the
capture-to-rank-up flywheel alongside the content work so the grimoire's maturity is
evidenced, not asserted.

SCOPE: `frameworks/homebrew/caravan-quartermaster/` only. Does not authorize changes to
any other grimoire, to shared canonical surfaces, or to the kernel.

---

## THE AUTONOMY LADDER

### Layer 0 — AUTONOMOUS to DRAFT (on convergent distinct-mind grade)
- Draft cargo manifests and expense summaries themselves (the grimoire's actual output).
- Prompt-wording fixes inside `frameworks/homebrew/caravan-quartermaster/prompts/**`
  that only change phrasing, not required inputs or output structure.
- Additive example fixtures under the grimoire's `docs/` — content that cannot change
  what the grimoire is graded against.

### Layer 1 — GOVERNANCE-gated → `/charter-quest` (operator plan-gate)
- Changes to the grimoire's manifest (`manifest.json`) — required inputs, output
  schema, or declared trust tier.
- Changes to `guardrails.md` for this grimoire.
- This charter itself, and its autonomy ladder — no self-amendment.

### Layer 2 — OPERATOR-GATED
- Rank-up (`/rank-up`) — moving the grimoire up the rank ladder is always an operator
  decision, never something this loop self-certifies into.
- Anything that would publish the grimoire (`/enshrine-grimoire`) beyond homebrew scope.

### Cross-cutting HARD gates
- **RATCHET:** a change that makes a previously failing manifest-draft pass is gated at
  Layer 1 if it does so by loosening what counts as a valid manifest, not by improving
  the draft itself.
- **CLASSIFICATION BY NON-PRODUCER:** whichever mind drafted an iteration's manifest
  output is not the mind that grades it.

---

## MIND ROUTING (disclose the model at every dispatch; tier to work altitude)

- A public-research mind — for general cargo-manifest formatting conventions or
  expense-summary best practices, public web only.
- A build/verification mind — checks the grimoire's manifest against
  `../policies/plan-contract.md`-equivalent structural expectations, runs any grimoire
  verifier that exists for it.
- The synthesis mind (main thread) — never the same mind that produced the draft under
  grade in the same iteration.
- Convene — only if a Layer 1 change is proposed; a single-mind judgment is not
  sufficient for a governance-gated change.

---

## THE CONTROL PLANE

Orient: read `_dev/reports/signals/` for any open Caravan Quartermaster signal, and this
charter's own iteration log. Cascade: log each dispatch + disclosed model to the
iteration log. Grade: attach the grade record + evidence to
`_dev/reports/analysis/caravan-quartermaster__iteration-<n>.md`. Improve: file Layer 1
proposals as quest charters under `_dev/reports/analysis/task-plans/`. Close: write a
chronicle via `/chronicle` for the iteration.

---

## EACH ITERATION

0. **ORIENT:** rebuild state from `_dev/reports/signals/` + git; pick one unblocked
   drafting or improvement unit; claim it by noting it in the iteration log.
1. **CASCADE DOWN:** produce the draft (a manifest or expense summary, or a Layer-0
   prompt fix) at the correct layer; the coordinator delegates the drafting leaf rather
   than producing it inline if a distinct familiar is available.
2. **GRADE:** a distinct mind reviews the draft against the grimoire's declared output
   shape; record score + rationale + named gaps.
3. **BUBBLE UP + IMPROVE:**
   - If the grade surfaces a genuine content gap fixable at Layer 0 (a missing cargo
     field, a phrasing improvement) → apply it, then loop back to step 1 for the next
     unit.
   - If the grade surfaces a Layer 1 gap (the manifest schema itself is wrong) → write a
     quest charter via `/plan-quest` and route it to `/trial-quest` for independent
     review before any `/embark`.
   - If enough iterations have produced convergent, distinct-mind-graded evidence that
     the grimoire is ready for its next rank → do NOT self-certify; surface a
     rank-up recommendation to the operator citing the evidence, and let the operator
     decide whether to run `/rehearse-grimoire` and then `/rank-up`.
4. **CLOSE:** run `/chronicle` for the iteration; note whether a capture is warranted —
   if this iteration's drafting pattern proved reusable beyond Caravan Quartermaster,
   flag it for `/claim-spoils` rather than quietly repeating it inline next time.

## THE CAPTURE-TO-RANK-UP FLYWHEEL

This charter treats capture as a first-class output, not an afterthought:

1. `/claim-spoils` — when a drafting pattern from this loop proves reusable, capture it
   as spoils rather than letting it live only in this charter's iteration log.
2. `/refine-spoils` — normalize the capture once it has a few real iterations behind it.
3. `/spoils-ledger` (`/capture-status`) — check readiness before scaffolding.
4. `/scribe-grimoire` — scaffold a new homebrew grimoire from the normalized capture, if
   the pattern turns out to be bigger than "a prompt fix inside Caravan Quartermaster."
5. `/initiate-status` (`/candidate-status`) — track the new candidate's maturity
   honestly: Iron until it has actually run, Bronze after one run, never claimed higher
   than the evidence supports.
6. `/rehearse-grimoire` then `/rank-up` — both operator-gated, both requiring the
   convergent multi-mind evidence this loop has been accumulating in its grade records.

## STOP + INTERRUPTABILITY

STOP when there is no unblocked Caravan Quartermaster unit left AND no Layer 1 proposal
is queued AND no rank-up recommendation is pending operator review. ALSO halt
immediately if a gate-classification question can't be resolved fail-closed, or after
the iteration cap. Report state and end. The operator can interrupt between any two
steps above.

---

This loop is the operator's scoped lift for Caravan Quartermaster only. It does not
authorize touching any other grimoire, shared canonical surfaces, or the kernel.
