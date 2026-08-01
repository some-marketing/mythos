# Quest charter: Concurrent-growth non-collision SOP (Phase A)

**Task ID:** concurrent-growth-non-collision-sop
**Scope:** system
**Risk tier:** medium (not BIG — Phase A is documentation/specification only)
**Review lane:** independent-review (Codex, distinct-family)
**Concept:** `_dev/concepts/concurrent-growth-non-collision-sop.md`
**Deliberation:** kernel-triad convene, `_dev/reports/analysis/convene-runs/20260801T185941Z-concurrent-growth-non-collision-sop-deliberate/`

## What this is

Originated as an `/aside` during the world-minds-tick-turn-operator-boundary workstream, after that work required ad hoc worktree isolation to protect a concurrent session. Classified `concept` by the aside agent; routed to `/bp-r` per operator instruction.

The kernel-triad deliberation corrected the initial framing: this isn't purely "audit and name existing machinery" — current custody is **post-write only** (recorded after a write happens), with no pre-write reservation. Two sessions can write the same file before anything stops it. A real (small) mechanism gap exists.

**This charter deliberately stops short of building it.** Phase A audits, documents the corrected isolation-trigger rule, and specifies the reservation contract/escalation matrix — but building the actual hook touches `tools/kernel/hooks/**` (L1 protected surface), which needs its own BIG-classified charter and operator gate. That decision is recorded as OD1, not made here.

## Steps (post charter-level review)

| Step | Mode | Depends on | Description |
|---|---|---|---|
| G1 | REVIEW_ONLY | — | Inventory liveness/custody/scope-boundary/approval-binding — four separate concerns, not one |
| G2 | PATCH_ALLOWED | G1 | Isolation trigger, corrected: **effective repository write-set × overlapping surface** (not mode-label — FINDINGS_ONLY/REVIEW_ONLY/RUN_ONLY all write in practice in this repo, per cited framework prompts) |
| G3 | PATCH_ALLOWED | G1 | Specify pre-write reservation contract + escalation matrix, with named fields (claim-key normalization, prefix-overlap, expiry/heartbeat, atomic acquisition, stale-claim recovery, rollback); "preserve both versions" requires pre-image capture before mutation |
| G5 | PATCH_ALLOWED | G1 | Record SOP residence + deliver an interim **manual** preflight/worktree checklist (not just a future spec) |
| G6 | REVIEW_ONLY | G2, G3, G5 | Distinct-family (Codex) review — now runs **before** the operator decision gate |
| G4 | REVIEW_ONLY | G6 | Decision gate: build the hook now (BIG, operator-gated) or defer with a named owner + trigger/date — recorded as OD1 |

`scope_identity.owned_artifacts` + a preflight requirement were added so this anti-collision plan doesn't itself demonstrate the defect it describes; execution surface is feature-branch + PR.

## Charter-level distinct review (complete)

**Reviewer:** Codex — verdict **approved-with-changes**, all 4 required changes folded 2026-08-01T19:08Z. Full review: `_dev/reports/analysis/convene-runs/20260801T190259Z-concurrent-growth-sop-charter-review/now__codex.md`.

## Operator decisions pending

- **OD1:** build the pre-write reservation hook now (fresh BIG charter, kernel-triad convene, touches `tools/kernel/hooks/**`), or defer with an explicit owner + trigger/date (not open-ended)?

## Execution (complete)

- **G1** — `_dev/concepts/concurrent-growth-non-collision-sop/g1-inventory.md`
- **G2** — `_dev/concepts/concurrent-growth-non-collision-sop/g2-isolation-trigger.md` (two independent predicates after G6 correction: write-set overlap, and shared-checkout-state disruption)
- **G3** — `_dev/concepts/concurrent-growth-non-collision-sop/g3-reservation-spec.md` (specification only; mandatory pre-image capture step added after G6 correction)
- **G5** — `_dev/concepts/concurrent-growth-non-collision-sop/g5-residence-and-manual-checklist.md` (usable now, no mechanism required)
- **G6** — two review passes: charter-level (approved-with-changes, 4 fixes) + execution-level (blocking, 5 fixes, all resolved)
- **G4 / OD1** — resolved: defer the reservation hook build until an actual concurrent-write collision is observed, then route to a fresh BIG-classified charter. `_dev/concepts/concurrent-growth-non-collision-sop/g4-decision-gate.md`

No `instructions/canonical/**` or `tools/kernel/hooks/**` files touched anywhere in this plan.

## Status

Complete. Delivered via isolated worktree + feature branch + PR, per `scope_identity.execution_surface`.
