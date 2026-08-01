# G2 — Isolation trigger (corrected)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G2 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01
**Correction note:** the first draft of this rule said "write-mode (PATCH_ALLOWED/COORDINATOR) × shared-surface-overlap" — i.e., only certain execution modes need isolation. Charter-level Codex review found this **false in this repository**: `FINDINGS_ONLY` writes to `verification_output/` (`frameworks/deliverables/scope-verification/prompts/01_ANALYZE.md:4-7`), `REVIEW_ONLY` writes design artifacts (`frameworks/meta/execution-normalization/prompts/02_NORMALIZED_EXECUTION_MODEL_DESIGN.md:3-5`), and `RUN_ONLY` writes reports (`AGENTS.md:85-92`) — despite their names suggesting they don't write. Mode label alone cannot be the trigger.

## Corrected rule

> **Isolation is required when: effective repository write-set × overlapping working surface.**
>
> Not mode-label × overlap. Not dirty-file count.

- **Effective write-set**: the actual set of paths a session (or its delegated children) will write, estimated from declared outputs (task-plan `owned_artifacts`, framework prompt output contracts) — mode can *seed* this estimate (a mode's typical write scope is a starting guess), but declared outputs and delegated child writes are what actually control.
- **Overlapping working surface**: another live session (per the active-session registry) has a working surface — its own declared or observed write-set — that intersects this session's effective write-set.
- **Dirty-file count is evidence, never the trigger.** A large dirty tree from unrelated concurrent work says nothing about whether *this* session's specific writes will collide with anything.

## Two independent predicates, not one rule

Charter-level (G6) review caught a contradiction in the original draft: it claimed the write-set-overlap rule "would flag" the PR #4 case, then admitted in the same paragraph that PR #4 had no file-write overlap and the actual hazard was something else entirely. That's not a validation of one rule — it's evidence of a **second, independent trigger**. Isolation is required when EITHER predicate is true:

- **Predicate A — write-set overlap:** effective repository write-set × overlapping working surface (defined above). Triggers reservation-style caution over the *specific files* about to be written.
- **Predicate B — shared-checkout-state disruption:** the action would change state that other live sessions currently depend on seeing consistently in the shared working directory (most concretely: switching the active branch of a shared checkout). This is independent of whether the new write-set overlaps any specific file — it's about not moving the ground under a concurrent session's feet.

These are not the same condition and must not be collapsed into one "the rule would flag this" claim.

## Worked validation (retroactive) — this session's own case

The world-minds-tick-turn-operator-boundary delivery (PR #4) is a **Predicate B** case, not Predicate A: its write-set (`_dev/concepts/world-minds-tick-turn-operator-boundary/`, `_dev/reports/analysis/task-plans/world-minds-*`, several `_dev/reports/analysis/convene-runs/*` directories) did not overlap any other session's declared working surface — the hazard was that switching the shared checkout's active branch (`client-storage-cloud-drives`, carrying 2,864 dirty files from unrelated work) could have disrupted a concurrent session's live view, regardless of file-level overlap.

This plan's own execution (the file you're reading) triggers **neither predicate** for the write itself — `_dev/concepts/concurrent-growth-non-collision-sop/` is a uniquely-named new path (no Predicate A) and the writes themselves don't touch the shared checkout's branch pointer (no Predicate B) — but delivery still routes through a feature-branch + PR per `scope_identity.execution_surface`, because the *delivery* step (getting this into the shared branch history) is itself a Predicate B action.

## Non-goals of this rule

- Does not itself implement any check — this is documentation. G3 specifies the mechanism for Predicate A; whether it gets built is G4/OD1's decision, recorded after this document and after G6 review, not pre-decided here.
