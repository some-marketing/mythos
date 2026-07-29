# Changelog (Patch Notes)

This file tracks framework-level changes intended to affect how tests are run, what artifacts are produced, and how results are handed off to developers.

## 2026-01-24

### Added
- Dev handoff bundle generator: `playwright_phased_runner/runner/tools/make-dev-handoff.js` (`npm run run:handoff:new`) to copy reports + testcase config + run artifacts + exports into `playwright_phased_runner/dev_handoff/`.
- Console-log assertion support: `locator_map.json > submit.success.expected_console_log_contains` enforces “tracking proof via console log” and writes `evidence/expected_console_logs.json`.

### Changed
- Reporting output folder renamed to be status-neutral:
  - Reports now live in `playwright_phased_runner/reports/`.
  - `playwright_phased_runner/failure_reports/` is deprecated (kept for compatibility, now contains a README only).
  - Prompt templates updated to reference `reports/` instead of `failure_reports/`.

### Runner Behavior
- A run can now be marked **FAIL** even when `submit.success=true` if required console-log evidence is missing (for example, GTM “test tag fired” proof).

