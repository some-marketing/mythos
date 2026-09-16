# tools/ant-hive-world/analysis

Shared, reusable analysis tools for `tools/ant-hive-world`, promoted out of a
task-scoped directory into the engine's own domain because they are useful
to any future work against this engine, not just the plan that built them.

## Provenance

Both tools were built during the `/go reward-contract-demand-side` run
(2026-08-14) as D1/D2 deliverables. They were originally scoped under
`tools/scoped/reward-contract-demand-side/`. The operator ratified their
promotion to this shared location on 2026-08-14T15:43Z, overriding the
plan's original one-run scoped caveat, because both tools are read-only or
sandboxed-write instruments against the engine itself (not client- or
plan-specific data) and are expected to be reused by future dynamics or
demand-side work on `tools/ant-hive-world`.

A stub remains at `tools/scoped/reward-contract-demand-side/README.md`
pointing here. The frozen evidence artifacts from the originating plan
(`_dev/reports/analysis/reward-contract-demand-side__closeout.md`,
`__ablation.md`) still cite the tools at their *original* scoped path as a
matter of historical record — that citation describes where the tools lived
when the plan's evidence was produced, and is intentionally left unchanged.

## `demand-decomposition.cjs`

Read-only whole-system food-balance reconstruction and outflow/prey-
trajectory/cap-timing decomposition over the srd2 instrumentation telemetry
schema (`spawn`/`regrow`/`grazing`/`upkeep`/`food_sources_after` per
transition, as produced by `tools/scoped/srd2-boundary-crossing-trial/
balance-audit.cjs`'s shim). Computes a conserved-inventory residual per
input file (patch total + hive stockpiles, fail-closed on any missing term
or genesis mismatch), grazing-vs-upkeep outflow shares, prey-population
trajectory classification, spawn cap-refusal rate and cap-occupancy timing,
and per-configuration stock-flow / mediator tables. Zero new sim runs; zero
engine edits; consumes only existing `srd2-telemetry.jsonl` files under
`_dev/sim-runs/srd2-ablation/`.

**Usage:**
```
node tools/ant-hive-world/analysis/demand-decomposition.cjs
```
Discovers every `_dev/sim-runs/srd2-ablation/*/srd2-telemetry.jsonl` file
automatically (no arguments) and writes
`_dev/reports/analysis/reward-contract-demand-side__decomposition.json` and
`.md`. Re-running is idempotent on the underlying numbers (only the
`generated_at` timestamp and the resulting `self_sha256` change on rerun);
do not rerun over a frozen/cited evidence artifact without first checking
whether another document pins its hash.

## `calibration-sweep.cjs`

Single-knob calibration sweep runner: one shared control run per seed, then
walks a named engine knob's grid away from control (early-stopping at the
first value whose measured whole-system net balance qualifies), using the
srd2 preload/module-cache instrumentation shim
(`tools/scoped/srd2-boundary-crossing-trial/balance-audit.cjs`, which does
**not** move — it belongs to the closed `srd2-boundary-crossing-trial` plan
and is referenced here by its original path) plus one additional thin wrap
that echoes the resolved `prey_graze_rate`/`max_prey`/`max_food_sources`
values the engine actually received on each run, so a knob change can be
proven dynamics-inert rather than merely un-configured. Zero engine-file
edits — both wraps live entirely in preload shims.

**Usage — shim mode** (installs instrumentation into a `run-live.js`
invocation; this is how every sandboxed run in the sweep is actually
launched):
```
node --require tools/ant-hive-world/analysis/calibration-sweep.cjs \
  tools/ant-hive-world/run-live.js \
  --ticks 300 --sandbox-root <dir> --root-seed <seed> \
  --run-name <name> --no-checkpoint
```

**Usage — orchestrator mode** (runs the full calibration sweep — this
launches real, sandboxed sim runs; do not invoke casually):
```
node tools/ant-hive-world/analysis/calibration-sweep.cjs
```
Writes `_dev/reports/analysis/reward-contract-demand-side__calibration.json`
and sandboxes each run under `_dev/sim-runs/rcds-ablation/`. There is no
`--help`/dry-parse flag; a safe way to confirm the module loads and its
path references (including the srd2 shim) resolve correctly without
launching any sim run is to `require()` it from another script rather than
running it directly as `node calibration-sweep.cjs`.
