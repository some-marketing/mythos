# tools/ant-hive-world/unreal-export

Converts a harvested ant-hive-world pull directory into `UnrealImport/1.0`
per-turn files for the Unreal-side timelapse renderer (plan
`unreal-world-projection`, steps S0/S1 --
`_dev/reports/analysis/task-plans/unreal-world-projection__plan.json`, frozen
across six codex review rounds).

Strictly a read-only projection consumer. Input is always a harvest
directory that has already crossed the courier boundary (guest -> orwell
sterile staging -> this repo) and carries a verified manifest chain. This
tool never opens a channel into a running guest, and never touches VM
config, seed, or golden image.

## Invocation

```sh
node tools/ant-hive-world/unreal-export/import-turn.js <harvest-dir> \
  [--out-dir <dir>] [--shuffles <n>]
```

- `<harvest-dir>` — a pulled directory such as `_dev/state/baseline-3000-r6`,
  containing `PULL-MANIFEST.txt`, `HARVEST-MANIFEST.txt`, and a run
  subdirectory (e.g. `baseline-3000-r6/`) with `RESULT-MANIFEST.txt`,
  `world-state.json`, and `turn-projection.json`.
- `--out-dir` — where the journal and per-turn output file are written.
  Defaults to this directory (`tools/ant-hive-world/unreal-export/`).
- `--shuffles` — permutation-null shuffle count for the mirror
  re-derivation. Defaults to `1000` (matches `mirror-detector.js`'s
  default). Must be a positive integer (`>= 1`); a zero, negative, or
  non-integer value is a usage error, both at the CLI and in `schema.json`.

Exit code `0` on success, `1` on a fail-closed refusal (manifest coverage
gap, hash mismatch, journal freeze violation, concurrent-import lock held,
corrupt journal line, or schema validation failure), `2` on a usage error
(missing `<harvest-dir>`, invalid `--shuffles`).

## What it does

1. Locates the run subdirectory (the one carrying `RESULT-MANIFEST.txt`)
   under `<harvest-dir>`.
2. Verifies `world-state.json` and `turn-projection.json` against **all
   three** manifests in the chain -- `RESULT-MANIFEST.txt` (in the run
   subdir), `HARVEST-MANIFEST.txt`, and `PULL-MANIFEST.txt` (both in
   `<harvest-dir>`) -- in two strictly ordered phases, per file:
   1. **Coverage, no payload read.** Confirm all three manifests carry an
      entry for the file, and that the three entries agree with each other.
      A missing entry in any manifest, or a disagreement between manifests,
      is a fail-closed refusal before a single byte of the file is read.
   2. **Payload read.** Only once all three entries agree does the importer
      read and sha256 the actual file bytes, and compare against the
      cross-checked expected digest. A mismatch here is also a fail-closed
      refusal.
   Either phase failing exits non-zero and writes nothing -- no journal
   entry, no output file.
3. Derives `build_ledger` from `world-state.json`'s `geometry_log`, and a
   deterministic mirror-detector re-derivation (see below).
4. Resolves this turn's `absolute_day_start` against the append-only
   journal (see below).
5. Assembles the `UnrealImport/1.0` document and validates it against
   `schema.json` before writing anything -- a document that fails
   validation is never written.
6. Writes `unreal-import__<turn_id>.json` next to the journal (atomic
   temp-file + rename, matching `world-state.js`'s write discipline).

## Schema summary (`UnrealImport/1.0`)

Top-level: `schema`, `turn_id`, `source`, `derived`, `provenance`,
`advisory`.

- **`source`** — fields read directly from `world-state.json`, unchanged:
  `geometry_log` (build events: `hive`, `kind`, `coords`, `tick`, `run_id`,
  `episode_id`, `state_at_event`), `resources` (`clay`/`fiber`/`food`/`mud`/
  `ore`/`stone`/`water`/`wood`), `prey_population`, `predator_population`,
  `territory`, `food_source_coords`, the `*_sources` maps (`food_sources`,
  `wood_sources`, `stone_sources`, `clay_sources`, `water_sources`,
  `ore_sources`, `fiber_sources`), `seq`, `complete`, `written_at`,
  `schema_version`.
- **`derived`** — computed by this importer, never present verbatim in
  `world-state.json`:
  - `build_ledger` — `geometry_log` mapped into the shape the Unreal
    renderer spawns actors from.
  - `mirror` — a deterministic re-derivation of `mirror-detector.js`'s
    permutation-null gate: `observed`, `null_mean`, `null_sd`, `p_value`,
    `n_builds`, `n_features`, `distinct_tiles`, `seed`, `shuffles`. `null`
    when `geometry_log` is empty.
- **`provenance`** — `turn_id`, `ticks`, `absolute_day_start`,
  `payload_hash`, `receipts` (one entry per manifest checked per file:
  6 entries for the 2 source files x 3 manifests in the chain).
- **`advisory`** — `mind_state`, `resume_continuity`, carried verbatim from
  `turn-projection.json`. Advisory only; never authoritative for rendering
  decisions.

Validated with `ajv/dist/2020` (already a repo dependency, used the same
way by `tools/ant-hive-world/validate-hive-mind.js`) against the
`draft/2020-12` schema in `schema.json`.

## Journal semantics (`import-index.jsonl`)

Append-only, one line per `turn_id`:
`{ turn_id, ticks, absolute_day_start, ingested_at, payload_hash }`.

- **First ingestion** of a `turn_id`: `absolute_day_start` is the sum of
  `ticks` for every turn already in the journal (append order), and a new
  line is appended. This value is then frozen.
- **Re-ingestion** of a known `turn_id`: the importer reuses the journaled
  `absolute_day_start` and requires the newly-computed `payload_hash` to
  match the journaled one. A mismatch is a fail-closed refusal (non-zero
  exit, nothing written, journal untouched) -- never a silent
  reassignment. Arrival or retry order can never change a previously
  assigned `absolute_day_start`.
- `payload_hash` is a sha256 over the sorted `("<run>/<file>:<sha256>")`
  pairs for `world-state.json` and `turn-projection.json`, computed from
  the hashes verified against `RESULT-MANIFEST.txt`. It is stable across
  re-imports of the same harvest directory and is the freeze/verify key.

### Write ordering (crash / partial-write safety)

Within a single import, the journal line is appended **last**, only after
the output file has been schema-validated, written to a temp file, and
renamed into place. Concretely: derive fields -> validate against
`schema.json` -> write `unreal-import__<turn_id>.json.tmp` -> rename to
`unreal-import__<turn_id>.json` -> append the journal line. Any failure
before that final append (schema validation, disk error, etc.) leaves
`import-index.jsonl` completely untouched -- an import never orphans a
frozen `absolute_day_start` for a turn whose output was never actually
emitted.

### Concurrency (`import-index.jsonl.lock`)

The read-journal / decide / write-output / append-journal sequence runs
under an exclusive lock file (`import-index.jsonl.lock`, created with the
`wx`/`O_EXCL` flag so acquisition itself is atomic). A second concurrent
`import-turn.js` invocation against the same `--out-dir` refuses outright
with the holding process's pid and acquisition time rather than
interleaving with the first. A lock left behind by a process that is
confirmed no longer running (stale) is automatically reclaimed; a lock
held by a live process is never broken automatically.

### Journal corruption (truncated or corrupt final line)

Loading the journal is tolerant in the sense that it fails closed rather
than guessing: if any line fails to parse as JSON (most commonly the last
line, from a process killed mid-append), the importer refuses to proceed
and names the exact line number plus a manual repair instruction. It never
auto-truncates or otherwise edits the journal on your behalf.

## Determinism note

`mirror-detector.js`'s permutation test uses `Math.random`, which is
unseeded and therefore not reproducible run-to-run. This importer ports the
same statistic (mean nearest-feature distance) and the same permutation
procedure, but drives it with a `mulberry32` PRNG seeded from a stable
32-bit FNV-1a hash of `turn_id`. Given the same harvest directory, the
importer always derives the same seed, runs the same number of shuffles
(recorded as `shuffles`), and therefore produces a byte-identical
`observed` / `null_mean` / `null_sd` / `p_value` every time -- any reviewer
can reproduce the emitted mirror block from the harvest directory alone.

## Deviations from the S0/S1 contract text, and why

- `build_ledger` is derived from the **full** `geometry_log`, not the last
  40 entries `dashboard.js`'s live view truncates to. The dashboard's
  truncation is a live-UI display concern (`slice(-40)`); this export is a
  durable per-turn artifact meant to drive a full timelapse reconstruction,
  so the complete build history is kept. `dashboard.js`'s ledger field
  shape (`hive`/`kind`/`coords`/`at`/*_at_build) is a display-flattened
  subset; this export instead keeps the full raw fields S0 names explicitly
  (`hive`/`kind`/`coords`/`tick`/`run_id`/`episode_id`/`state_at_event`)
  since Unreal needs `tick`/`run_id`/`episode_id` for timelapse ordering
  and provenance, which the dashboard's flattened view drops.
- `source` deliberately omits `world-state.json`'s `writer` field (not part
  of the S0-named source field list) and `pheromones`/`discovered_types`
  (not named in S0 either) -- kept out to hold the contract to exactly what
  S0 specifies, not the full raw file.
