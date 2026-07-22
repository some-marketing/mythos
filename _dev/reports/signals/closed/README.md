# `reports/signals/closed/`

Signals that have been consumed, resolved, or superseded — moved here with a
`lifecycle_state: "closed"` marker and a `closed_at` timestamp, per
`../../../policies/data-handling.md`. Plain gloss: your handoff-file archive, kept
separate from the live queue so the live queue stays trustworthy.

Closed signals retain a bounded retention window before they're eligible for the
dated `archive/` surface.
