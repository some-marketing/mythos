# Task Plan — unreal-world-projection

> Operator direction 2026-08-04T21:19Z: "timelapse is fine but i want it in unreal"
> Scope: system · Risk: medium · Review lane: codex-bridge · Status: REVIEW-CLEARED (see Status section); S1 code in repair per codex trial 20260805T001403Z

## What

An Unreal Engine visualization on the orwell host (RTX 5070 Ti) that renders the
ant-hive-world building itself in 3D, timelapse-style: short Orwell turns (~100–250
ticks) run in a loop, each harvest produces a per-turn `UnrealImport/1.0` file, and
the Unreal scene advances as each turn lands — territory tiles, builds appearing at
their real recorded coordinates, resources, and a HUD with turn id / absolute day /
mirror-detector p-value.

**Hard boundary, unchanged from the owning contract:** strictly a read-only consumer
of the sanitized post-turn projection that already crosses the courier. No channel
into a running guest, no VM/seed/golden/courier change, Unreal never inside the VM.
Timelapse is cadence parameterization of the existing turn mode, not a contract
change.

## Steps

- **S0** — Cadence + interface contract: frozen `UnrealImport/1.0` schema derived from
  the ACTUAL fixture keys (verified 2026-08-04T23:54Z against r6 AND r7):
  `geometry_log` build events + `resources` + top-level `prey_population`/
  `predator_population` + `territory` + feature coordinate maps + `seq`. No `culture`
  or `hives` key exists — build ledger and mirror stats are importer DERIVATIONS from
  `geometry_log`, computed as dashboard.js computes them. Deterministic day mapping:
  `turn_id` = turn-projection `run_name`; per-turn span = its `ticks` (1 tick = 1
  day); `absolute_day` = cumulative ticks across a PERSISTED append-only index
  journal (`import-index.jsonl`) — values freeze at first ingestion, re-imports must
  match the journaled payload_hash or FAIL CLOSED (never silent reassignment);
  arrival/retry order cannot change assigned values. Mirror derivation is
  DETERMINISTIC: importer-owned PRNG seeded from a stable hash of turn_id (not
  mirror-detector's unseeded Math.random), seed + shuffle count recorded for
  byte-reproducible p-values. Provenance hashes from the RESULT/HARVEST/PULL manifest
  chain. Fixture validation of both baselines must pass before S2. (Revised per codex
  rounds 2–5; round 6: cleared at plan altitude.)
- **S1** — Projection importer (`tools/ant-hive-world/unreal-export/import-turn.js`):
  harvested `out/` → schema-validated per-turn files. Deterministic, idempotent.
- **S2** — UE5 project scaffold on orwell (`D:\UnrealProjects\AntWorldProjection`):
  data-driven level spawning actors from import files; turn-advance + auto-advance.
  **GATE G-ORWELL-UNREAL-INSTALL — mostly dissolved 2026-08-04T23:34Z:** UE 5.7.4 and
  5.8 are already installed at `C:\Program Files\Epic Games` (probe-verified,
  operator-confirmed). Residual approval: the new project directory, S3's watch
  service files, and engine-version choice (default UE 5.8).
- **S3** — Timelapse consumption wiring (REVISED per codex review 20260804T212131Z):
  importer-only. Unreal watches for named, immutable, manifest-verified post-turn
  harvests and advances the scene when one lands. It never invokes run-job, harvest,
  or CANCEL — turn orchestration and the short-turn cadence stay owned by
  `ant-world-orwell-live-dashboard`. Producer contract (turn_id, absolute_day, run id,
  payload hash, boundary receipt) bound explicitly in S0.
- **S4** — Verify + debrief: schema receipts, recorded multi-turn timelapse session,
  membrane checks unchanged, distinct-family review bound to exact commits.

## Overlap disposition

`ant-world-orwell-live-dashboard` is the nearest owner (0.375) — deliberately NOT
amended: it is mid-execution on a high-risk operator-gate lane and scoped to the
deployment/turn contract; this plan shares only its data surface. Interface bound in
S0.

## Review history

- Codex GPT-5.5 review `20260804T212131Z` (structural precheck passed, no blockers):
  prescribed importer-only consumption (applied above), full install-footprint
  enumeration under the gate (applied), explicit producer-contract fields (bound to
  S0), and `scope_identity.owned_artifacts` (added). Operator decisions it surfaced:
  (1) post-turn-consumer-only — default TAKEN, reversible; (2) approve the enumerated
  install footprint (= G-ORWELL-UNREAL-INSTALL); (3) confirm the producer contract
  fields at S0 review.

## Status

REVIEW-CLEARED 2026-08-05T00:03Z: codex GPT-5.5 round-6 verdict — "Rounds 2–5 are
closed at plan-review altitude; no issue exceeds S1 implementation/code-review
scope." Six adversarial rounds total (runs 20260804T212131Z through
20260804T235926Z). G-ORWELL-UNREAL-INSTALL residual approvals delegated by operator
2026-08-04T23:37Z with reversible defaults. Execution proceeds via `/run-plan`
semantics under the `/go` orchestration shape; S1's importer code receives its own
distinct-family trial at its fold.
