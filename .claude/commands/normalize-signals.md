---
description: Normalize the live signal surface by closing stale, consumed, or duplicate signals
mode: COORDINATOR
---

<objective>
Audit the live signal surface for staleness, duplicates, and broken artifact references, then close signals that should not remain live, and verify the resulting surface is clean.
</objective>

<process>
- Parse arguments for scope filter (all or a specific signal_scope).
- Phase 1 — Audit: spawn a read-only subagent to scan _dev/reports/signals/ for all JSON files, classify each by schema type, and check live HandoffSignal/1.0 files for supersession, duplicate signal_scope conflicts, broken artifact references, ready-for-clear status, and missing next-step guidance.
- Phase 2 — Normalize: if the audit found closable signals or conflicts, spawn the signal-normalizer agent to close signals via node tools/signals/close-signal.js --file <name> --execute, then validate remaining live signals. Skip this phase if Phase 1 found no issues.
- Phase 3 — Verify: spawn a read-only subagent to re-scan the live signal surface and confirm no duplicate signal_scope conflicts, no superseded signals, and all remaining live signals have valid artifact references. Report pass/fail.
- Write durable artifacts: _dev/reports/analysis/normalize-signals__<timestamp>.md (full normalization report with before/after state) and _dev/reports/analysis/normalize-signals__<timestamp>.expectation-failures.json (structured findings, empty failures array when clean).
- Report to the user: signals closed count, remaining live signal count, whether the surface is clean, and any unresolvable issues.
</process>

<success_criteria>
- Live signal surface audited for staleness, duplicates, supersession, and broken artifacts
- Closable signals closed via close-signal.js
- Remaining live signals validated for artifact truth and next-step guidance
- Durable normalization artifact written (markdown and JSON)
- Independent verification confirms surface cleanliness after normalization
</success_criteria>

<handoff>
surface_clean: use the exact command from plan-active-workstreams.next-step.json
unresolvable_conflicts: review-active-workstreams
all_workstream_signals_closed: plan-active-workstreams
</handoff>
