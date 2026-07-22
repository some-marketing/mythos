# `reports/signals/`

Structured, live handoffs between actors — a signal says "this work-unit is at state
X, here's the evidence, here's what should happen next" without either actor having to
re-derive it from chat. Plain gloss: your inter-agent handoff-file directory.

Keep this surface small: close a signal (move it to `closed/`) as soon as the next
actor has consumed it. A signal that never closes is stale state pretending to be live.
