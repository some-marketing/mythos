# Task Plan — ant-world-checkpoint-loader

> Source: operator ratification 2026-08-05T01:49Z of convene synthesis
> `20260805T014353Z-ant-world-next-round-input` (kernel triad, consequence-grade)
> Scope: system · Risk: medium · Review lane: codex-bridge · Status: DRAFT → codex review

## What

Implement the checkpoint save/load the convene contract requires and codex proved
absent (`world-mind.js` declares weights never-persisted): a complete, atomic,
guest-local resume image — mind parameters + optimizer state + full RNG lineage +
world state in lockstep + identity/goal fields — sealed by a generation manifest
with per-file checksums whose arrival at its final path is itself the single commit
token (manifest-rename-last, no separate marker). Unlocks the ratified next round:
the short-turn continuity control (2–3 × ~150 ticks, each resuming the prior
checkpoint, no goal).

## Steps (in sync with plan.json as of r2 amendment, 2026-08-05T02:05Z)

- **S0** — `CheckpointManifest/1.0` with generation-level lockstep atomicity: one
  staged generation dir `gen-<absolute_day>-<run_name>/` holding ALL state files
  (mind + world + RNG + identity), per-file sha256 in the manifest, and the manifest
  renamed into place LAST as the **single authoritative commit token** (no separate
  marker; checksum-valid manifest at final path = committed). Uncommitted
  generations swept on start; last-known-good never auto-deleted; **collision =
  fail-closed refusal** (`STATUS=checkpoint-collision:<id>`), never overwrite. The
  legacy world-checkpoint block in the runner (user-data) is REPLACED, not wrapped.
- **S1** — First deliverable: `state-inventory.md` (in S1's write set) from a
  mechanical audit listing EVERY RNG stream and mutable state by file:line; then
  `checkpoint.js` + `world-mind.js` serialization covering the complete inventory.
  Byte-identical save→load→save; restored first-N decisions match a continued run's
  under frozen inputs.
- **S2** — `RESUME_FROM=<generation-id>` via job.env (+ `-ResumeFrom` passthrough in
  run-job.ps1). The resume gate is the **first act of run-live.js after job.env
  parsing** — before any fresh-mind init, world load, or RNG seeding; five-stage
  fail-closed validation (exists → committed manifest → version compat → checksums →
  parent linkage), each refusing with `STATUS=resume-failed-halt:<stage>:<reason>`
  and zero state ever constructed. Absent field = explicit `fresh_start=true`
  provenance. S0's writer replacement lands in the same slice — no old-writer/
  new-reader coexistence window.
- **S3** — Frozen-input replicated **five-arm** continuity control, n=2 each:
  **A** (150 ticks → checkpoint → resume → 150), **A′** (300 ticks uninterrupted,
  same seeds — the equivalence standard: A's post-resume trajectory must match A′'s
  ticks 151–300, byte-equality target), **B** (fresh seeds), **C** (shuffled-RNG:
  same seeds, permuted stream assignment), **D** (tamper → checksum-stage refusal).
  Pass = A≡A′ AND A/A′ replicably diverge from B and C AND D refuses. Fresh arms
  double as r6/r7 regression check. Evidence under
  `_dev/state/checkpoint-continuity-test/`.
- **S4** — Codex distinct trial bound to commits (incl. the state inventory itself)
  + debrief. **G-CHECKPOINT-REVIEW**: only after this clears does the owning plan's
  next G-REMOTE-MUTATION packet include the rebuilt payload.

## Boundaries

Checkpoints live under `/opt/antworld/_dev/state/checkpoints/` — guest-local,
NEVER on the courier; sanitized projection unchanged; no VM/seed/golden/provisioning
changes beyond the job.env passthrough; the owning plan
(`ant-world-orwell-live-dashboard`) keeps deployment and its operator gate.

## Amendment r1 (2026-08-05T01:58Z, per codex review 20260805T015114Z — REJECT_PENDING_AMENDMENT, 4 MAJOR + 1 MODERATE, all applied)

- **Generation-level atomicity**: a checkpoint = one staged generation dir
  (`gen-<absolute_day>-<run_name>/`), all state files + per-file sha256, manifest
  renamed last as the SOLE commit boundary; uncommitted generations swept;
  last-known-good never auto-deleted. The legacy world-checkpoint block in the
  runner is REPLACED, not wrapped.
- **State inventory as deliverable**: S1 begins with `state-inventory.md` from a
  mechanical audit of every RNG consumer and mutable state (file:line); serialization
  must cover the full inventory; the inventory is reviewed at S4.
- **Exact resume semantics**: `RESUME_FROM=<generation-id>`; five-stage validation
  order, each failing closed with `STATUS=resume-failed-halt:<stage>:<reason>` and
  zero state mutation; fresh starts recorded explicitly.
- **S3 is now frozen-input replicated A/B/C/D**: checkpointed lineage, fresh-seed,
  shuffled-RNG (permuted stream assignment), and tamper arms; n=2 replicates;
  concrete evidence paths under `_dev/state/checkpoint-continuity-test/`.
- **Gate added**: G-CHECKPOINT-REVIEW — S4's codex trial must clear before the owning
  plan's next deployment packet includes the rebuilt payload.
- Coordinator defaults disclosed (generation-id syntax, n=2, shuffle construction) —
  taken under the operator's delegation, overridable.

## Amendment r3 (2026-08-05T02:11Z, per codex r3 — 2 MAJOR + 1 MODERATE applied)

- **Exact call site**: the resume gate is `resolveResumeOrFreshStart(jobEnv)` invoked
  immediately after job.env parsing in run-live.js, gating the state-construction
  block at L77–137; refusals use the existing courier STATUS path; the user-data
  runner change is definite (forwards RESUME_FROM).
- **Frozen-input semantics defined**: time-derived seeds ELIMINATED in S1 (explicit
  root seeds in job.env/provenance — no arm depends on invocation time); S3 control
  arms use no console decision packets by default (or a byte-identical recorded
  packet replayed to all arms, hashed into evidence); run/episode identity must not
  feed RNG or decisions (inventory-verified).
- Top-level wording aligned to the manifest-only commit token.
- Convergence note: rounds r1–r3 applied 11 findings; any r4 sub-plan precision items
  transfer into the implementation contract as named open items with the S4 code
  trial (G-CHECKPOINT-REVIEW) as backstop, per the operator's standing delegation.

## Next

Codex r4 confirmation pass, then `/go`.
