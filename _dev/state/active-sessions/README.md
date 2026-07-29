# `state/active-sessions/`

Markers for sessions currently in flight — one file per live session, letting other
actors (or a returning session) see what's already running before starting duplicate
work. Plain gloss: a lightweight live-session registry, not a full session transcript.
