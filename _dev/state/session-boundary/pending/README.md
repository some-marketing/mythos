# `state/session-boundary/pending/`

Markers dropped at the end of a session that a new session is expected to pick up and
clear. Plain gloss: a cross-session handoff queue — one file per pending boundary,
consumed and removed by the session that resumes it.
