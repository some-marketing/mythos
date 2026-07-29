# docs/REPORTING_PIPELINE.md
Deterministic extraction + LLM interpretation pipeline.

## Why two layers
- Deterministic tools give stable facts and indexes (diffable, reliable).
- LLM interpretation produces human narratives and hypothesis-driven guidance.

## Layer 1: Deterministic extraction (tools)
Outputs (recommended):
- `reports/index.json` — master index
- `reports/run_status.md` — completeness matrix
- `reports/cookie_summary.md` — extracted cookie signals
- per-run: `runs/<run>/derived/extracted.signals.json`

Deterministic outputs must:
- be stable ordering
- avoid embedding sensitive raw values
- reference paths, not copy large artifacts

## Layer 2: LLM interpretation
Outputs:
- per-run: `derived/run.summary.md` + `.json`
- per-run narrative: `derived/run.narrative.md`
- cross-run anomalies: `reports/anomalies.index.md` + `.json`
- developer packet: `For_Developer.md` + `dev_handoff/<bundle>/...` (current convention)

## How to keep it safe
- LLM should never rewrite raw artifacts.
- LLM should not include full cookies or HAR content in narrative; it should cite file paths.

## Indexing for retrieval
Prefer both:
- per-run `run.summary.json`
- global NDJSON `reports/all_artifacts.ndjson` (one artifact record per line)
