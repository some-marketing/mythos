#!/usr/bin/env bash
# tools/life-sim/freeze-baseline.sh
#
# Pipeline: pull baseline CSV from a remote sim host -> plot -> compute
# thresholds -> freeze.
#
# Usage:
#   ./freeze-baseline.sh [--remote-host <user@host>] [--csv-path <remote-path>] [--output-dir <dir>]
#   (or set REMOTE_HOST / CSV_PATH / OUTPUT_DIR env vars)
#
# Prerequisites: keyless SSH auth to the remote sim host, Python 3 with
# matplotlib (for plotting). Safe: read-only from the remote host, writes
# only to the local output dir.
#
# This is a generic "pull a CSV telemetry baseline over SSH, plot it,
# compute mean+2-sigma thresholds, write a freeze manifest" pipeline. It has
# no dependency on any specific simulation's content -- only the CSV column
# names in plot-baseline.py's plot_series() calls are simulation-specific
# (population/traits/energy/predator-dynamics columns), and those are
# trivially swappable for a different sim's telemetry schema.
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-}"
CSV_REMOTE="${CSV_PATH:-}"
OUTPUT_DIR="${OUTPUT_DIR:-./baselines}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$REMOTE_HOST" ] || [ -z "$CSV_REMOTE" ]; then
  echo "Usage: REMOTE_HOST=<user@host> CSV_PATH=<remote-csv-dir> ./freeze-baseline.sh"
  echo "  (or pass --remote-host / --csv-path)"
  exit 2
fi

mkdir -p "$OUTPUT_DIR/$RUN_ID"

echo "=== Sim Baseline Freeze Pipeline ==="
echo "Run ID: $RUN_ID"
echo "Output: $OUTPUT_DIR/$RUN_ID"
echo ""

# 1. Pull the latest CSV from the remote host (the one with most recent write time)
echo "[1/4] Pulling CSV from $REMOTE_HOST..."
LATEST_CSV=$(ssh "$REMOTE_HOST" "powershell -Command \"Get-ChildItem '$CSV_REMOTE' -Filter '*.csv' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { \\\$_.FullName }\"" 2>/dev/null | tr -d '\r')
if [ -z "$LATEST_CSV" ]; then
  echo "  FAIL: No CSV found on $REMOTE_HOST at $CSV_REMOTE"
  exit 1
fi
echo "  Latest: $LATEST_CSV"
scp -q "$REMOTE_HOST:${LATEST_CSV//\\//}" "$OUTPUT_DIR/$RUN_ID/raw.csv"
ROW_COUNT=$(tail -n +2 "$OUTPUT_DIR/$RUN_ID/raw.csv" | wc -l | tr -d ' ')
echo "  Rows: $ROW_COUNT"
DURATION=$(tail -1 "$OUTPUT_DIR/$RUN_ID/raw.csv" | cut -d',' -f1)
echo "  Duration: ${DURATION}s"

# 2. Generate plots (if plot-baseline.py exists)
echo ""
echo "[2/4] Generating plots..."
PLOT_SCRIPT="$SCRIPT_DIR/plot-baseline.py"
if [ -f "$PLOT_SCRIPT" ]; then
  python3 "$PLOT_SCRIPT" "$OUTPUT_DIR/$RUN_ID/raw.csv" "$OUTPUT_DIR/$RUN_ID"
  echo "  Plots written to $OUTPUT_DIR/$RUN_ID/"
else
  echo "  SKIP: plot-baseline.py not found"
fi

# 3. Compute frozen thresholds (mean + 2 sigma)
echo ""
echo "[3/4] Computing frozen thresholds..."
python3 - "$OUTPUT_DIR/$RUN_ID/raw.csv" "$OUTPUT_DIR/$RUN_ID/thresholds.json" << 'PYEOF'
import sys, csv, json, math

csv_path = sys.argv[1]
out_path = sys.argv[2]

cols = {}
with open(csv_path) as f:
    reader = csv.DictReader(f)
    for row in reader:
        for k, v in row.items():
            if k == 'focal_id' or k == 'elapsed_s':
                continue
            try:
                cols.setdefault(k, []).append(float(v))
            except ValueError:
                pass

thresholds = {}
for name, values in cols.items():
    if len(values) < 2:
        continue
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1) if len(values) > 1 else 0
    sigma = math.sqrt(variance)
    thresholds[name] = {
        "n": len(values),
        "mean": round(mean, 4),
        "sigma": round(sigma, 4),
        "mean_plus_2sigma": round(mean + 2 * sigma, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }

with open(out_path, 'w') as f:
    json.dump(thresholds, f, indent=2)
print(f"  {len(thresholds)} metrics computed -> {out_path}")
PYEOF

# 4. Write freeze manifest
echo ""
echo "[4/4] Writing freeze manifest..."
cat > "$OUTPUT_DIR/$RUN_ID/manifest.md" << MANIFEST
# Baseline Freeze — $RUN_ID

- **CSV source:** $(basename "$LATEST_CSV")
- **Rows:** $ROW_COUNT
- **Duration:** ${DURATION}s
- **Thresholds:** thresholds.json (mean + 2-sigma per metric)
- **Plots:** $(ls "$OUTPUT_DIR/$RUN_ID"/*.png 2>/dev/null | wc -l | tr -d ' ') generated
- **Status:** PENDING OPERATOR REVIEW

## Metrics snapshot

| Metric | Mean | sigma | Mean+2sigma |
|--------|------|---|---------|
$(python3 - "$OUTPUT_DIR/$RUN_ID/thresholds.json" << 'PYEOF2'
import json, sys
with open(sys.argv[1]) as f:
    t = json.load(f)
for name in sorted(t):
    v = t[name]
    print(f"| {name} | {v['mean']:.4f} | {v['sigma']:.4f} | {v['mean_plus_2sigma']:.4f} |")
PYEOF2
)

## Next step

Review thresholds -> ratify or adjust -> record the frozen thresholds wherever this project keeps its evaluation-suite baseline.
MANIFEST

echo "  Manifest: $OUTPUT_DIR/$RUN_ID/manifest.md"
echo ""
echo "=== PIPELINE COMPLETE ==="
echo "Review the manifest and thresholds, then:"
echo "  cat $OUTPUT_DIR/$RUN_ID/manifest.md"
echo ""
echo "To ratify: update your evaluation-suite doc with the frozen thresholds from thresholds.json"
