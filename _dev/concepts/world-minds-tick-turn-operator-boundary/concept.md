---
title: World-minds governance layer — tick/turn cadence and operator-boundary scope
identified: 2026-08-01
context: /bp-r chain (Fable5 -> Codex -> Gemini -> Perplexity -> Gemini -> Codex -> Fable5), grounded in prior harness-propagation-doctrine convene
---

## Problem

The operator proposed a "world minds" layer: agents aware of the system's end goals, positioned to (a) help prevent actors/minds that would break kernel tenets, and (b) manage ongoing communication between the operator and other sessions ("minds inside the membrane"). A full 7-hop sequential deliberation chain (solo plan -> distinct review -> distinct review of that review -> external research -> reverse review x2 -> closing reflection) tested this against both Mythos doctrine and actual repo truth.

The chain converged that the proposal, as stated, conflates two different things — a transport/relay layer (viable) and a governor/enforcer layer (not viable without violating producer-never-validates-own-trial) — and that even the "just reuse what's already built" instinct for the transport half was not executable as stated against the real repo (`tools/channels/watch-text-ingestion.js` is a one-way, untrusted, overwrite-not-append intake collector, not an operator-command channel; `tools/signals/lib/signal-lifecycle.js` evaluates signals rather than ingesting them; no database-backed coordination log currently exists).

After reviewing that synthesis, the operator sharpened the actual gap: this isn't primarily a "build a governance agent" problem. It's a missing **cadence and authority model** — the system currently has no explicit definition of what a "tick" of autonomous/simulated execution means versus a "turn" (an operator-facing interaction boundary), and no explicit map of which checkpoints require operator input versus which can be handled by whatever governance layer eventually exists. That gap is what made both Fable5's original plan and Gemini's reuse proposal too abstract to execute: without a tick/turn/checkpoint model, there was no seam to hang an "authenticated_operator_decision vs untrusted_operator_intake" schema on.

## Decision

Treat "world minds" as out of scope for now. Treat "define tick vs turn, and operator-checkpoint vs autonomous-governance boundaries" as the actual concept worth planning. This is Phase 0 from the prior synthesis, restated in the operator's own vocabulary — not new scope, but the correct name for the gate that was already identified as blocking.

No canonical instruction edits, no new agents, no monitor daemon, no execution controller — this concept produces, at most, a definitional/schema artifact and a bounded Phase 1 (the intake-adapter migration already scoped in the prior synthesis) to route through `/plan-quest`.

## Rationale

All seven hops of the prior chain converged, independently, on the same missing piece: nothing in the repo currently defines an authenticated operator-decision boundary distinct from ordinary (untrusted) inbound text or ordinary autonomous agent action. Codex named it as the one thing that must be clarified before anything else ("unsafe fiction" otherwise); Fable5's closing reflection upgraded it to a Phase 0 gate, not a Phase 1 task. The operator's framing — tick vs turn, checkpoint vs governance — gives that gate concrete engineering shape:

- **Tick**: a unit of autonomous/simulated progression that requires no operator input by design (matches existing execution-mode machinery: RUN_ONLY, PATCH_ALLOWED scoped work, the orchestrate-loop TRIVIAL/BOUNDED altitude tiers).
- **Turn**: an operator-facing interaction boundary — a point where the system is, by design, waiting on or presenting to the operator (matches existing session/boundary-crossing machinery: `/new-session`, `/shutdown`, pending boundary scopes, REVIEW_ONLY/COORDINATOR gates).
- **Checkpoint**: the explicit, named set of conditions where a tick must escalate to a turn — money, live/irreversible action, secrets/PII, brand/authority judgment (this list already exists almost verbatim in the `/bp-r` skill's research-resolve step and in `orchestrate-loop`'s bubble-up criteria).

The work here is likely **naming and unifying an existing, scattered pattern** (execution modes + orchestrate-loop altitude + boundary-crossing/session machinery + bp-r's operator-only triage list) into one explicit tick/turn/checkpoint vocabulary — not inventing a new authority structure. That should be tested, not assumed, during planning.

## Open questions carried forward (for /plan-task, not resolved here)

1. Is this genuinely a naming/unification exercise over existing mechanisms, or does it require a new mechanism? (Testable: try to express 3-5 real historical checkpoint moments from this session's own history — e.g., the destructive-git-command gate, the convene-receipt gate on canonical writes — in tick/turn/checkpoint vocabulary and see if anything doesn't fit.)
2. Does "world minds" (the governance/enforcement half) get formally shelved, or does this concept explicitly recommend against ever building it, pending Phase 1 adapter evidence per the prior synthesis's rank-honesty note (Bronze before Silver)?
3. Where does this concept intersect with the existing `HarnessCapabilityPolicy/1.0` (auto_apply:false / review_required:true) — is a tick/turn/checkpoint model a new policy file, an amendment to an existing one, or purely descriptive (documentation of what already governs, not a new gate)?

## Next Steps

Route to `/plan-quest` (plan-task) with system scope, carrying this concept and the full prior synthesis (`_dev/reports/analysis/convene-runs/20260801T180254Z-harness-propagation-doctrine/world-minds-synthesis.md`) as grounding context. Plan-task should assess similarity against existing grimoires/frameworks before proposing anything new.

## Status (2026-08-01, post-execution)

- **G1** (inventory): complete — `context/g1-inventory.md`, 9 surfaces classified with file:line citations.
- **G2** (falsification test): complete — `context/g2-falsification-test.md`. 4/4 checkpoint examples fit cleanly (including one autonomous/non-escalating tick example); the membrane law correctly falls outside the vocabulary as a negative control (invariant, not a checkpoint). One structural refinement surfaced: checkpoints split into *conditional* (most cases) and *permanent* (custody-grant release firewall) shapes.
- **G4** (decision gate): unification holds. No new mechanism required — this resolved as a naming/documentation exercise, per the test verdict in G2.
- **G3** (vocabulary doc): complete — `tick-turn-checkpoint-vocabulary.md`. Documentation only; no `instructions/canonical/**` edits made.
- **G5** (world-minds disposition — this section): **The world-minds governance/enforcement layer (the monitor/governor half of the original proposal) remains shelved. It is not built, not scheduled, and not planned on any timeline.** It stays shelved pending the separately-scoped Phase 1 intake-adapter (replacing `TextIntakeSignal/1.0` with a validated `HandoffSignal/2.0`-compatible event in `tools/channels/watch-text-ingestion.js`, per `world-minds-synthesis.md`) shipping and producing evidence that an LLM-based monitor would add value beyond the checkpoint mechanisms already inventoried in G1 — evidence the 7-hop convene chain's external research (correlated monitor/target failure, shared jailbreak vulnerability) suggests should not be assumed by default. This directly resolves the operator's OD2 confirmation.
- **G6**: pending — distinct-family (Codex) review of G1–G5, requested next.
