# Telemetry — dispatch tree assembly + optional Langfuse export

The native, authoritative telemetry surface is an append-only JSONL span log
at `_dev/reports/telemetry/dispatches.jsonl`. Everything in `dispatches/`
reads and writes against that file (or assembles trees from it); Langfuse
export is a render-only adapter on top, entirely optional, and off by default.

## What's here

- `lib/trace-context.cjs` — the trace/span-id propagation contract: reads the current trace context from `MYTHOS_TRACE_ID`/`MYTHOS_SPAN_ID`/etc. env vars, and builds the next child's env for a dispatched subagent or worker.
- `lib/emit-span.cjs` — appends one span record to the dispatches log from the current trace context.
- `lib/completion-events.cjs`, `lib/detectors.cjs`, `lib/percentile-stats.cjs`, `lib/parse-usage-block.cjs` — span/completion parsing and detection helpers (stall/cascade/anomaly detectors).
- `lib/assemble-tree.cjs` — assembles the full dispatch tree for a given trace id from the flat JSONL log (newest-wins de-dup, fail-open on lock contention).
- `lib/append-lock.cjs` — a simple file lock for concurrent appenders.
- `lib/export-cursor.cjs`, `lib/session-trace-store.cjs` — incremental-export bookkeeping.
- `detect-cascade.cjs`, `print-cascade.cjs`, `rollup.cjs`, `query.cjs`, `lint-spans.cjs` — CLI utilities over the dispatch log.
- `seed-root-trace.cjs` / `seed-root-trace.sh` — seed a fresh root trace/span pair for a new top-level session.

## Optional Langfuse export

- `export-to-langfuse.mjs` — pushes one cascade's spans into a Langfuse trace (same `id` as the `correlation_id`), nesting LiteLLM model-call generations underneath if you also run the `broker/` LiteLLM gateway. **Off by default** — dry-runs (builds + reports, no network write) unless you pass `--enable` or set `MYTHOS_LANGFUSE_EXPORT`.
- `lib/langfuse-export.cjs` — the export logic (event building, generation re-parenting, multi-pass settle logic for LiteLLM's async generation flush).
- `lib/litellm-trace-metadata.cjs` — reads the LiteLLM-attached trace metadata shape so generations can be joined back to the right span.
- `run-export-with-op.sh` — resolves Langfuse keys via 1Password (see `env.example`) and runs the exporter.
- `run-export-daemon.sh` / `README-export-daemon.md` — an always-on poller variant for a persistent host; also off by default.
- `verify-p3a-cascade-render.mjs`, `verify-litellm-langfuse-join.mjs` — manual verification scripts for the export pipeline.

## Setup

Copy `env.example` to `.env`. `TELEMETRY_HOST` and the Langfuse vars are the only configuration this needs; nothing here requires credentials unless you turn on the Langfuse exporter.

## What didn't come along

Two of the original test files (`__tests__/c6-harness-coverage.test.cjs`,
`test-session-trace-store.cjs`, and part of `__tests__/c6-2-sentinel.test.cjs`)
exercise integration points with `.claude/hooks/subagent-telemetry-writer.cjs`
and `tools/signals/lib/dispatch-bridge.js` — the actual span-emission hook and
the cross-actor dispatch-bridge machinery, both out of scope for this port
(separate Wave-2 architecture-scaffold work). Those tests fail here with
`MODULE_NOT_FOUND` for exactly that reason; the core assembly/export logic
they don't touch (detectors, export-cursor, visibility-contract,
langfuse-export, assemble-tree) all pass unmodified.
