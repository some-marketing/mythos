# Quest charter: Tick/turn/checkpoint vocabulary (world-minds narrowed)

**Task ID:** world-minds-tick-turn-operator-boundary
**Scope:** system
**Risk tier:** medium (not BIG — no protected-path or canonical edits in scope)
**Review lane:** independent-review (Codex, distinct-family)
**Concept:** `_dev/concepts/world-minds-tick-turn-operator-boundary/concept.md`
**Grounding:** `_dev/reports/analysis/convene-runs/20260801T180254Z-harness-propagation-doctrine/world-minds-synthesis.md` (7-hop chain: Fable5 → Codex → Gemini → Perplexity → Gemini → Codex → Fable5)

## What this is

The operator's original proposal — a "world minds" governance layer — was tested through a full sequential deliberation chain and found to conflate a viable transport concern with a non-viable self-appointed-enforcement concern. The operator then sharpened the real gap: the system has no explicit **tick vs turn** cadence model (autonomous progression vs operator-facing interaction boundary) and no explicit map of **checkpoint vs governance** — which decision points need operator input versus which existing machinery already covers them.

This charter is that narrower, testable piece. It does **not** build a governance agent, monitor, or execution controller.

## Steps

| Step | Mode | Depends on | Description |
|---|---|---|---|
| G1 | REVIEW_ONLY | — | Inventory existing checkpoint/authority mechanisms with file:line citations AND an authority classification per surface (canonical rule / executable gate / advisory hook / historical evidence). Altitude tiers cited correctly as an advisory hook, not canonical orchestrate-loop authority. |
| G2 | REVIEW_ONLY | G1 | Falsification test — express ≥4 real historical checkpoint moments (incl. ≥1 autonomous/non-human-gated example) in tick/turn/checkpoint vocabulary, with contemporaneous evidence per moment. Membrane law treated as a negative control, not a checkpoint. |
| G3 | PATCH_ALLOWED | G4 | Write the vocabulary as a documentation artifact (not canonical), on a feature branch — only if G4 finds unification sufficient. Skipped otherwise. |
| G4 | REVIEW_ONLY | G2 | Decision gate: unification sufficient, or new mechanism needed? New-mechanism findings bubble to operator (OD1), not built inline. Decides whether G3 runs. |
| G5 | PATCH_ALLOWED | G1 | Record explicit shelved-pending-evidence disposition on the world-minds governance/enforcement half. |
| G6 | REVIEW_ONLY | G4, G5 | Distinct-family (Codex) review of charter execution and G3 output (if produced), before plan completion/merge — not before `/run-plan`, which would be temporally impossible. |

## Distinct-family review (charter-level, complete)

**Reviewer:** Codex (GPT-5.5, distinct family) — verdict **approved-with-changes**, all 6 required changes folded 2026-08-01T18:44Z (dependency-graph deadlock in the G4-fails branch; temporally-impossible G6 criterion; altitude-tier mis-citation; unbounded G1 scope; weak G2 falsification design; missing canonical-exclusion/feature-branch acceptance criteria). Full review: `_dev/reports/analysis/convene-runs/20260801T183846Z-world-minds-08-charter-review/now__codex.md`. `risk_tier:medium` / `big:false` confirmed correct by the reviewer.

## Operator decisions pending

- **OD1:** if G4 finds a genuine new-mechanism gap, auto-route to a fresh `/bp-r`, or pause for direct operator review first?
- **OD2:** confirm the world-minds governance/enforcement layer stays shelved pending Phase 1 adapter evidence (not built now, not scheduled).

## Status

Distinct-family review complete and folded. **Awaiting operator approval** (`/trial-quest` step 5) before `/embark world-minds-tick-turn-operator-boundary`.
