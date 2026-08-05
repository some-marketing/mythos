---
name: text-operator-after-runs-and-meditations
description: "Operator 2026-08-05 — after every sim run and every meditation, send an iMessage with a layman's summary; what we improved / what we learned / what we'll think about next"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-05T04:45:17.726Z
---

Operator direction 2026-08-05T04:45Z: "i'd like a text after each sim run and each
meditation loop with a laymans summary of the takeaways, what did we improve? what
did we learn? what will we think of next?"

**Why:** The operator shouldn't need to read debriefs to stay connected to the two
worlds' progress; the tick-tock deserves a human-readable pulse.

**How to apply:** At the close of every completed sim round (debrief's final act)
and every /meditate: send an iMessage via the imessage plugin tools (self-chat;
resolve chat_id via chat_messages if unknown) with exactly three short, jargon-free
parts: "What we improved", "What we learned", "What we'll think about next". Keep
it a summary — artifacts remain the record. Encoded in
.claude/skills/meditate/SKILL.md (emit step) and the goal-round plan's S3. See
[[run-learn-meditate-improve-cadence]].
