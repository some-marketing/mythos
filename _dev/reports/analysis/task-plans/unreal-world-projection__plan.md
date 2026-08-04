# Task Plan — unreal-world-projection

> Operator direction 2026-08-04T21:19Z: "timelapse is fine but i want it in unreal"
> Scope: system · Risk: medium · Review lane: codex-bridge · Status: DRAFT, awaiting /trial-quest

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

- **S0** — Cadence + interface contract: short-turn loop definition + frozen
  `UnrealImport/1.0` schema (turn id + absolute-day provenance on every file).
- **S1** — Projection importer (`tools/ant-hive-world/unreal-export/import-turn.js`):
  harvested `out/` → schema-validated per-turn files. Deterministic, idempotent.
- **S2** — UE5 project scaffold on orwell (`D:\UnrealProjects\AntWorldProjection`):
  data-driven level spawning actors from import files; turn-advance + auto-advance.
  **GATE G-ORWELL-UNREAL-INSTALL: operator approves the Unreal install on orwell
  before S2 begins.**
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

## Next

Re-run `/trial-quest unreal-world-projection` on this revised draft; then `/go` once
reviewed and G-ORWELL-UNREAL-INSTALL is decided.
