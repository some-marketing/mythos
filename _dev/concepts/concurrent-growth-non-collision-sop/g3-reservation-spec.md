# G3 — Pre-write reservation contract (specification only — not built)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G3 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01
**Status: SPECIFICATION ONLY.** This document makes no mechanically-authoritative or enforcement-complete claim. No hook, script, or gate implementing this exists. Whether and when it gets built is OD1, decided at G4 (after this document and after G6 review — not pre-decided here; see `_dev/reports/analysis/task-plans/concurrent-growth-non-collision-sop__plan.json`).

## Why this is needed (per G1)

None of the five existing mechanisms (liveness, post-write ledger, git-custody gate, boundary markers, plan-run-gate hashing) checks, *before* a write happens, whether another live session has already claimed an overlapping write-set. Two sessions can currently write the same file before any existing mechanism reacts.

## The contract

1. **Declare target set.** Before writing, the actor states the exact path(s) or path-prefix(es) it intends to write.
2. **Claim-key normalization.** Paths are normalized (resolved, case-consistent, trailing-slash-consistent) before comparison, so `_dev/concepts/foo` and `_dev/concepts/foo/` are recognized as the same claim key.
3. **Prefix-overlap semantics.** A claim on a directory prefix (e.g. `_dev/concepts/foo/`) conflicts with any claim on a path under that prefix, not just an exact-path match.
4. **Detect overlapping live claims.** Check active claims from other sessions (keyed by session/run id) against the normalized target set for prefix or exact overlap.
5. **Acquire exclusive reservation.** If no overlap, atomically create a claim record (the specific primitive — e.g. `open(O_CREAT|O_EXCL)`, matching the pattern already used by the custody-grant transactional-consumption mechanism — is an implementation decision for the deferred build, not fixed here).
6. **Expiry / heartbeat.** A claim without a refreshing heartbeat within a defined window is stale and eligible for reclaim — mirroring the active-session registry's existing TTL semantics (G1 item 1), not inventing a new liveness model.
7. **Pre-image capture (MANDATORY, before any mutation of an existing artifact).** Before writing, if the target path already exists, capture its current bytes and hash. This step is not optional and is not deferrable to "if a collision is later detected" — per G6 review, the escalation matrix's "preserve both versions" requirement is only executable if the pre-image was captured *before* the write, because once a second write has landed, the original bytes are gone. New-file creation (no existing target) has no pre-image to capture and skips this step.
8. **Write atomically.** Perform the write (temp-then-rename, or equivalent atomic primitive appropriate to the artifact type).
9. **Record hash.** Post-write, record the resulting (post-image) content hash (extends the existing post-write ledger pattern, G1 item 2).
10. **Release or transfer custody.** On completion, release the claim (or transfer it, for a handoff case) — explicit, not implicit expiry, for the normal-completion path.
11. **Stale-claim recovery.** A claim whose owning session is confirmed dead (not just TTL-stale) is recoverable via an explicit, auditable path — not silent reclaim, mirroring the custody-grant quarantine-release precedent (never fully automatic for anything resembling an override).
12. **Rollback.** If the write fails after claim acquisition but before completion, the claim releases and no partial artifact is left in a state that looks complete.

## Escalation matrix

| Situation | Response |
|---|---|
| Proven prospective overlap (another live claim covers this target) | **Hard block**, absent an explicit custody grant transferring the claim |
| Unknown custody, read-only or unique-creation | **Warn**, proceed |
| Unknown custody, mutation of an existing artifact | **Fail closed** |
| Detected actual collision (two writes landed) | **Stop.** Present the **pre-image** captured at step 7 (before mutation — this is why step 7 is mandatory, not optional: without it, the original bytes are already gone by the time a collision is detected) alongside the post-image and both hashes. Mark `needs_context`. Require operator-selected reconciliation. **Never silently merge.** |

## Explicitly out of scope for this specification

- The atomic acquisition primitive's exact implementation.
- Where claim records live (filesystem, a lightweight local store, or reuse of `_dev/state/active-sessions/`).
- Whether this becomes a `PreToolUse` hook, a library function growth-commands call explicitly, or both.
- Any actual code. This document is a decision table for a future BIG-classified charter to implement against, per OD1.
