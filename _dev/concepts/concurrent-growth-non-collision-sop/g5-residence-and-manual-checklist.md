# G5 — SOP residence + interim manual procedure

**Plan:** concurrent-growth-non-collision-sop
**Step:** G5 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01

## Residence

This SOP's working artifacts (G1–G3, this document) are staged under `_dev/concepts/concurrent-growth-non-collision-sop/`. Promotion to a canonical governance surface (e.g. `instructions/canonical/governance/concurrent-growth-sop.md`, per the Stage-1 deliberation's suggestion) is a **separate, explicitly ConveneReceipt-gated step** — not performed by this plan. `instructions/canonical/**` writes require a live ConveneReceipt/1.0, which this plan does not hold and does not attempt to obtain.

## Interim manual procedure (usable now, no mechanism required)

Since the pre-write reservation mechanism (G3) is deferred pending an observed collision (OD1), the following is the actual, immediately usable procedure until then:

1. **Before a write, judge Predicate A (write-set overlap) and Predicate B (shared-checkout-state disruption) separately** (per G2's corrected two-predicate rule). "Non-trivial" for Predicate A means: the write touches an existing artifact (not a brand-new uniquely-named path) OR modifies more than a handful of files OR the artifact path is a directory prefix another session might plausibly also write under (e.g. a shared state or signal directory) — judge by what you're actually about to write, not your execution mode's label. Check `_dev/state/active-sessions/` for entries with a working surface that overlaps your intended write-set. Note: the registry's current overlap helper (`sessions/lib/active-session-registry.js:644-651`) does substring matching, not path-prefix-aware comparison — a human/agent doing this check manually should compare normalized path prefixes directly rather than trust the helper to catch every case.
2. **If Predicate A overlap is found, OR Predicate B applies (the shared checkout's active branch carries unrelated dirty work you don't own, or your delivery step would move the shared branch pointer):** do not switch the shared checkout's branch. Use `EnterWorktree` to create an isolated worktree on a fresh branch, do the work there, and deliver via `git push` + PR from that worktree.
3. **If neither predicate applies** (no overlap, and the write-set is a small number of uniquely-named new paths not touching the shared branch pointer): writing directly in the shared checkout is acceptable; delivery still routes through a feature branch + PR (never a direct commit to a shared branch), per repository contribution policy, since delivery itself is a Predicate B action.
4. **On completion:** use `ExitWorktree` with `keep` if the branch has been pushed (nothing is lost by leaving the local worktree), or `remove` only after confirming the work is pushed or intentionally discarded.
5. **If you discover you already collided with another session's write** (same file, unexpected content): stop, do not overwrite further, and surface it to the operator rather than reconciling silently — this is the `needs_context` behavior G3's escalation matrix specifies for the future mechanized version, but it applies as a manual discipline right now.

**Note on precedent, not validation:** this session's PR #4 delivery used the worktree-isolation shape described in step 2 (for a Predicate B reason, per G2), before this document existed to name it as a procedure. That is one prior instance informing this checklist's design, not an execution-evidence-backed validation that the checklist as written is complete or sufficient — no formal test of this procedure has been run.
