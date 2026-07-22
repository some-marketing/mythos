# `state/`

Machine-readable state that lets an actor rebuild "what's true right now" without
relying on chat memory. Plain gloss: your durable-state directory — small JSON files,
each scoped to one concern.

Subdirectories: `plan-task-review-state/` (review progress per charter),
`active-sessions/` (live session markers), `motivation/` (scan/check-in state),
`session-boundary/pending/` (cross-session handoff markers awaiting pickup).
