# G1 — Inventory: liveness, custody, scope-boundary, approval-binding (four separate concerns)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G1 (REVIEW_ONLY)
**Date:** 2026-08-01
**Citations verified by Codex during charter-level review** (`_dev/reports/analysis/convene-runs/20260801T190259Z-concurrent-growth-sop-charter-review/now__codex.md`); restated here as the inventory artifact.

Per the Stage-1 deliberation, these are four *separate* concerns and must not be collapsed into one mechanism.

## 1. Liveness — active-session registry
`sessions/lib/active-session-registry.js:627-641`. Session membership is heartbeat/TTL-derived. Answers "is this session probably still running," not "does this session own this artifact." Malformed/stale entries are excluded, not authoritative.

## 2. Custody (write-tracking) — post-write ledger
`tools/kernel/hooks/posttool-write-ledger.cjs:4-6,83-93`. Fires PostToolUse (after a write already happened), fail-open. Records what was written, does not prevent a second concurrent write to the same path before this ledger runs.

## 3. Custody (commit-time enforcement) — git-custody gate
`tools/kernel/hooks/pretool-git-custody-gate.cjs:3-17,1030-1042,1198-1203`. Intercepts `git add`/`git commit` specifically — not ordinary artifact writes. Blocks proven foreign custody; passes unknown custody by default. This is the mechanism that fired during the world-minds workstream's canonical-write attempts, but it only guards the git-staging boundary, not the filesystem-write boundary.

## 4. Scope-boundary — boundary markers
`sessions/lib/boundary-markers.cjs:62-79`. `writeMarker()` unconditionally renames onto the same normalized per-scope path. Solves cross-scope clobbering (two unrelated workstreams don't overwrite each other's handoff). Does NOT solve same-scope concurrent writes — two sessions both writing to the *same* scope's marker still race.

## 5. Approval-binding — plan-run-gate hashing
`tools/planning/lib/plan-run-gate.js:10-19` (the `hashPlanPair()` function itself; the `run_authorization_only` authority declaration is separately at `:92-103` — correcting a citation error from an earlier draft of this document that conflated the two line ranges). Binds run authorization to exact plan bytes, rejecting drift between what was reviewed and what executes. A real design precedent for "bind to exact bytes, reject silent drift," but not a general artifact-write collision mechanism. Worth reusing the *pattern* (hash-bind), not assuming it *already covers* concurrent writes.

## The gap these five leave open

None of the five is a **pre-write reservation**: a check, before a write happens, of whether another live session has already claimed an overlapping write-set. Liveness (1) tells you who's alive; custody (2, 3) tells you what happened after the fact or gates git specifically; scope-boundary (4) prevents cross-scope collision but not same-scope; approval-binding (5) prevents *drift* between review and execution, not concurrent *writes* by different actors. This is the mechanism gap G3 specifies (not builds).
