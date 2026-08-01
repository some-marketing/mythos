---
description: Read-only homeostatic motivation scan: derive mechanical pressures from durable artifacts and emit a ledger plus a human-readable report. Never executes, never emits proposals, never routes.
mode: REVIEW_ONLY
---

<objective>
Produce a truthful, side-effect-free homeostatic motivation ledger (_dev/state/motivation/homeostasis.json) and a human-readable report (_dev/state/motivation/last-scan-report.md) by reading durable artifacts only. The ledger surfaces drive signals as evidence for later gated steps; this command itself authorizes nothing. Interpretive-assessment pressures are flagged and may NEVER drive auto-execution (kernel-crystallization 5.6); only artifact_countable pressures are eligible, and even then only via later gated steps outside this command's scope.
</objective>

<process>
- Resolve the repo root from the script location (tools/motivation/motivation-scan.js), not from the current working directory.
- Read durable artifacts ONLY: task plans (_dev/reports/analysis/task-plans/*__plan.json), live HandoffSignal files (_dev/reports/signals/*.json with lifecycle_state === live), debriefs (_dev/reports/analysis/run-debrief__*.md), and validation reports (_dev/reports/analysis/closeout-validation__*.json).
- Derive mechanical pressures: open_loops (incomplete status-tracked plans), stale_signals (live signals older than the staleness window), unpaired_debriefs, failing_tests (read from validation reports only — tests are NOT executed), operator_waiting_items, and the interpretive coverage_gaps pressure.
- Classify each pressure as artifact_countable or interpretive_assessment per the S1 schema. Interpretive pressures are evidence-only and quarantined from auto-execution.
- Honor the operator-suppressible keep_open flag: when set on a pressure, suppress its drive signal to zero while preserving the pre-suppression magnitude in raw_components.
- Maintain uncategorized_signal_count: every durable signal/artifact observed but not classifiable into a pressure increments this counter, so the ledger cannot look healthy by narrow coverage.
- Fail safe: if an input cannot be read, log the failure to the report diagnostics and continue; increment uncategorized_signal_count where appropriate. Never abort the whole scan on one bad file.
- Validate the assembled ledger against _dev/state/motivation/homeostasis.schema.json. Refuse to write a ledger that fails validation.
- Write ONLY the two output files (ledger + report). With --dry-run, write nothing and print the would-write summary instead.
</process>

<success_criteria>
- Produces a schema-valid ledger object from durable artifacts with zero execution side-effects
- Each pressure carries pressure_class, raw_components, computed_pressure, and the keep_open flag (no label-only output)
- uncategorized_signal_count is an integer reflecting unclassifiable observed artifacts
- --dry-run writes nothing and reports what it would write
- No proposal artifacts emitted and no command routed or triggered
</success_criteria>

<handoff>
ledger_ready: Operator or a later gated governor step (S3+) consumes _dev/state/motivation/homeostasis.json; this command does not route to it
schema_invalid: Inspect _dev/state/motivation/last-scan-report.md validation errors; fix derivation; re-run
</handoff>
