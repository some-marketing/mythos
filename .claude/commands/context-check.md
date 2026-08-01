---
description: Read current session's Tier 0 contextual hints — surfaces relevant memories, live signals, and ledger entries
mode: REVIEW_ONLY
---

<objective>
Surface the contextual-mind's pre-attentive output for the current session — a glanceable list of memory-ledger entries, live coordination signals, and auto-memories scored as relevant. Tier 0 only. No LLM filtering.
</objective>

<process>
- Identify the current session by reading the most-recent _dev/state/active-sessions/<sid>.json whose current_branch matches the current git branch. If multiple match, take newest last_heartbeat.
- Run a fresh sweep: node tools/memory/contextual-sweep.js --session-id <sid> --dry-run. --dry-run prints scored hits without re-writing persisted hint files.
- Read the persisted glanceable summary if it exists: cat _dev/state/contextual-hints/<sid>.tier0.txt. Compare to the fresh sweep — if they diverge, scheduling is stale or working_surface has changed.
- Present hits to the operator as a tight summary: top 10 hits with score + source + ref, live-signal hits flagged (1.5x score bonus), ledger drift entries flagged (Tier 2 priority), suggest 1-2 hits that look load-bearing for current work.
- Do NOT auto-act on hits. This is pre-attentive surfacing, not direction.
</process>

<success_criteria>
- A scored hit list reaches the operator
- Top hits are tagged by source (ledger / signal / memory)
- Live-signal and drift hits are flagged as higher-priority
- Output is glanceable, not a wall of text
</success_criteria>
