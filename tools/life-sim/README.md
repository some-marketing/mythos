# life-sim

A small, generic baseline-freezing pipeline for evolutionary/agent
simulations that emit CSV telemetry (population counts, per-tick traits,
energy distribution, predator/prey dynamics, etc).

This is a two-file utility extracted from a larger private project. Both
files are already fully generic -- there was no world-canon content to
strip here, only a private remote host's hostname, username, and path,
which have been replaced with configurable placeholders.

## What's here

- **`freeze-baseline.sh`** -- pulls the most recent CSV telemetry file from
  a remote sim host over SSH, runs `plot-baseline.py` against it, computes
  mean+2-sigma thresholds per numeric column, and writes a dated freeze
  manifest (`manifest.md`) summarizing the run for operator review. Takes
  `REMOTE_HOST` / `CSV_PATH` / `OUTPUT_DIR` as env vars (or `--remote-host`
  / `--csv-path` / `--output-dir` flags); the original hardcoded a specific
  private host and Windows path as defaults, both now required arguments
  with no baked-in default.
- **`plot-baseline.py`** -- reads the CSV and renders four plots
  (`population.png`, `traits.png`, `energy.png`, `predator.png`) via
  matplotlib. The only simulation-specific part is the column-name list
  passed to each `plot_series()` call (`pop`, `predators`, `mean_speed`,
  `energy_q50`, `pred_kills`, etc) -- swap those for your own sim's CSV
  schema and the rest of the script works unchanged.

## Verified

- Both files pass a syntax check (`bash -n` / `python3 -m py_compile`).
- `plot-baseline.py` was run end-to-end against a synthetic CSV fixture
  (matching the expected column schema) and correctly produced all four
  PNG plots.
- The threshold-computation step embedded in `freeze-baseline.sh` (mean,
  sample standard deviation, mean+2-sigma, min/max per column) was
  extracted and run standalone against the same synthetic CSV; it produces
  correct per-column statistics.
- The SSH-pull step (step 1 of the pipeline) was not executed end-to-end,
  since it requires a real remote host with matching telemetry files --
  the script only shells out to standard `ssh`/`scp`/`powershell` with
  no simulation-specific logic in that step.
