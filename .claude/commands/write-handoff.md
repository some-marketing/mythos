---
description: [DEPRECATED — use /next-session] Write a NEXT_SESSION handoff artifact for a client or system workstream
mode: PATCH_ALLOWED
---

<objective>
Generate a canonical NEXT_SESSION handoff document that captures what was done, what is blocked, and what the next session should start with. Writes to the scope-appropriate location and archives the previous version.
</objective>

<process>
- Determine scope: if --client CODE is provided, write to clients/{CODE}/NEXT_SESSION.md; if --system is provided, write to _dev/NEXT_SESSION.md; if neither, infer from the most recent task plan context or ask the operator.
- If a NEXT_SESSION.md already exists at the target path and --archive is not false, copy it to an archive location: clients/{CODE}/plans/archive/NEXT_SESSION__{ISO-date}.md or _dev/reports/analysis/archive/NEXT_SESSION__{ISO-date}.md.
- Gather context for the handoff: recent git activity, task plan status, completed/blocked/executable items, and any open signals or operator gates.
- Write the NEXT_SESSION.md with sections: COMPLETED THIS SESSION, BLOCKED (with specific blockers), READY TO EXECUTE (with exact commands), and CONTEXT NOTES (anything the next session needs to know).
- Report what was written and where.
</process>

<success_criteria>
- NEXT_SESSION.md written to the scope-appropriate location
- Previous version archived if one existed
- Handoff contains actionable next-session guidance with exact commands
- This command does NOT overlap with /whats-next — it writes artifacts, /whats-next reads and briefs only
</success_criteria>

<handoff>
handoff_written: Next session starts with /whats-next to read the briefing
scope_unclear: Operator specifies --client CODE or --system
</handoff>
