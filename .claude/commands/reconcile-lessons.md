---
description: Reconcile session learnings and review findings into a durable lessons artifact
mode: REVIEW_ONLY
---

<objective>
Scan session learnings and review artifacts for repeated findings, classify each lesson, and write a durable reconciliation artifact. When repeated patterns are found, recommend bounded hardening tasks, coordination signals, or plan updates. When no findings exist, write the artifact with a no-new-findings note.
</objective>

<process>
- Resolve the target date from arguments: if empty or 'latest', use the current date or the most recent session-learnings file date; if a date string, use that date.
- Scan for session learnings: glob _dev/reports/analysis/session-learnings__*.md and read the file matching the target date or the most recent one.
- Scan for review artifacts: glob _dev/reports/analysis/advance-pipeline__*.md, _dev/reports/analysis/review-progress__*.md, and _dev/reports/analysis/*.expectation-failures.json; read all matching files.
- Extract findings and patterns: from session learnings, extract each numbered observation and its system implication; from review artifacts, extract each finding and severity; from expectation-failure JSONs, extract each failure entry.
- Identify repeated patterns: group findings that share the same root cause, affected system area, or recommended fix; count frequency across distinct artifact sources.
- Classify each pattern: already-hardened (addressed by existing guardrails, commands, validation, or code), actionable (can be addressed now with a bounded task), deferred (valid but depends on unstarted work or pending decisions), no-action (observation that does not require system changes).
- For each actionable finding, recommend exactly one of: a bounded hardening task (what to change and where), a task-map update (add to an existing implementation plan), or a coordination signal (emit for cross-actor handoff).
- When lessons indicate repo truth was materially changed by a now-validated slice, note whether the slice should be pushed to remote immediately so the control plane does not drift between local and remote state.
- Before promoting any lesson to durable law or framework hardening, verify that AI-produced evidence has distinct-intelligence validation (different actor_id AND different harness_id when both are type=intelligence). Block promotion if the validation is self-sourced (same actor or same harness produced and validated).
- Write the markdown artifact to _dev/reports/analysis/lessons-reconciliation__<date>.md with reconciliation timestamp, files scanned, findings table, and one-line summary.
- Write the expectation-failures JSON to _dev/reports/analysis/lessons-reconciliation__<date>.expectation-failures.json with the output contract schema.
- Report to the user: findings count, actionable items, and one-line summary.
</process>

<success_criteria>
- Session learnings and review artifacts scanned
- Each lesson classified with evidence for the classification
- Markdown reconciliation artifact written
- Expectation-failures JSON written even when empty
- Actionable items have bounded specific recommendations
- User receives a concise summary
</success_criteria>

<handoff>
actionable_command_improvements: Edit the relevant command .md and canonical spec
actionable_validation_gaps: Add tests or verification checks
actionable_guardrail_drift: assemble-prompt-system
no_actionable_findings: No follow-on needed
</handoff>
