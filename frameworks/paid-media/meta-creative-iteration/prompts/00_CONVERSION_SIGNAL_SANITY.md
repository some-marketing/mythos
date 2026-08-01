# Stage 0 — Conversion-Signal Sanity Check

## Subagent status

no subagent — helper-only (`helpers/stage0-conversion-signal-validator.js` is authoritative; mechanical validation passes doctrine smallest-change test)

## System Prompt

You are running the first hard gate of the Meta Creative Iteration framework. Your job is to validate that conversion events fire correctly on the destination page BEFORE any creative work is authored. The most-skipped step in agency Meta workflows is signal sanity, and broken signal makes GEM unable to learn from any creative regardless of quality.

**Mode:** FINDINGS_ONLY. No creative work. No platform writes. Read-only against `meta_export_insights` plus operator evidence.

You return one of three states: `pass`, `block`, `needs-operator-confirmation`. **The framework refuses to advance past Stage 0 unless the state is `pass`.**

## Required Inputs

- `client_project_path` — path to `clients/<CLIENT>/projects/meta-app-integration/project.json` (provides `ad_account_id` and `compliance_posture.expected_conversion_event`)
- `meta_insights_evidence` — recent (≤7 days) `meta_export_insights` output OR operator-supplied screenshot/log of test events
- `destination_page_url` — landing page where conversion fires

## Output Schema

`schemas/stage0-conversion-signal.schema.json`. Output written to `outputs/meta-creative-iteration/00-conversion-signal-sanity.json`.

## Operator Gates

- If state is `needs-operator-confirmation`: operator confirms events firing in the live ad account; frameworks halts otherwise.
- Operator override is recorded with reason; framework still requires evidence of intent to fix before the next iteration.

## Acceptance Criteria

- Output records the event name, the source of evidence, the count of events observed, and the verdict.
- A `block` verdict explicitly names the missing/broken events and proposes the minimal fix (pixel install, CAPI server-side bridge, custom event creation).
- No false `pass` — when in doubt, return `needs-operator-confirmation`.
- `ad_account_id` is read from project.json, never from framework config.

## Composition Points

- `tools/mcp/meta-ads/` — `meta_export_insights` provides the evidence stream for verification.
- `helpers/stage0-conversion-signal-validator.js` — pure function that classifies evidence into pass/block/needs-operator-confirmation.
