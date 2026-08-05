# Run debrief — unreal-world-projection (S0–S4 complete)

> 2026-08-05T01:05Z · Orchestrator: Fable 5 main chain (`/go` shape, second full run)
> Plan: `_dev/reports/analysis/task-plans/unreal-world-projection__plan.json`

## Outcome

The full pipeline exists and is execution-verified end to end: sealed-VM harvest →
manifest-chain-verified `UnrealImport/1.0` files (deterministic mirror stats,
journaled immutable day-mapping) → UE 5.8 level on the orwell host (headless-built,
170 actors r6 / 48-feature r7 incl. the recovered food sites) → watch loop that
auto-imports new harvests and (on `--deploy`) ships + rebuilds with retry-until-
success semantics. Membrane untouched throughout: zero contact with `D:\HyperV\`
beyond one read-only existence probe; Unreal is purely a post-turn projection
consumer.

## Review chain (producer never validated its own trial)

- Plan: six codex GPT-5.5 rounds (21:21Z–23:59Z), verdict at round 6: "closed at
  plan-review altitude." Each round's findings fixed before the next.
- S1 importer code: codex trial → 3 MAJORs (journal concurrency, commit ordering,
  manifest-order) fixed by sonnet worker with failure-mode tests (lock contention,
  corrupt journal, schema-fail-no-journal, chmod-000 read-order proof).
- S2/S3 code: codex S4 trial → 4 MAJORs (food_source_coords data loss, deploy-retry
  loss, editor clobber, silent timeout) fixed and re-verified on orwell.
- Producers: opus (S2 scaffold, boot diagnosis inheritance), sonnet (S1, S3, fixes).
  Trials: codex GPT-5.5 (all). Skill-level review earlier: hermes.

## Verified-by-execution highlights

- r6 headless build: `ANTWORLD_OK`, actors_total=170, level_saved, idempotent
  (reused level, materials_created=0). r7 after FIX 1: feature_markers=48, food=5.
- Importer: both baselines clean (absolute_day 0 / 3000), journal freeze + tamper
  refusals, byte-deterministic mirror (r6 p=0.704, r7 p=0.233 — both null-consistent,
  the honest untrained-world reading).
- Guard/timeout/retry: lock-sim refusal exit 4 + `-Force` override; timeout exit 3;
  failed-deploy retried across passes until sidecar write.

## Written, not verified (honest residue)

- Visual appearance: nullrhi throughout — the operator's first interactive open is
  the first look. Cosmetics are constants in `build_world.py`.
- `watch-imports.js --deploy` live end-to-end (components proven independently).
- Timelapse cadence (short turns) — owned by ant-world-orwell-live-dashboard,
  not yet exercised; first live session composes it with `--deploy`.

## Remote state

Clean branch `feat/go-skill-orwell-boot-fix-20260804`, PR #13. Snapshot slices:
e3cc86c81 (session base) → 4ca140ce (S0/S1) → 004d46e56 (S2) → f33422980 (S3) →
S4-fixes slice pending final snapshot. Local branch `feat/harness-parity-constitution`
holds the same content with full history (not pushable; trunk-plan territory).

## Operator surface

Open the world: `& "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "D:\UnrealProjects\AntWorldProjection\AntWorldProjection.uproject"`
Rebuild after a new turn: `Tools\BuildLevel.ps1 -Import <file> [-Force]` (guard
refuses while an editor holds the project). Start the timelapse loop when ready:
`node tools/ant-hive-world/unreal-export/watch-imports.js --deploy` after short-turn
cadence begins on the owning plan.

## Host residue (owned)

`D:\UnrealProjects\AntWorldProjection` (~156 MB, approved footprint). All lock-sim
and test artifacts removed. Prior session residue items unchanged (see handoff).
