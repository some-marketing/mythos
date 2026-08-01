---
description: Write a canonical NEXT_SESSION handoff artifact capturing session outcomes, blockers, and the exact next pickup command
mode: PATCH_ALLOWED
---

<objective>
Produce a structured, machine-readable handoff document that records what was accomplished, what is blocked, what the next operator session should pick up, and the exact command to start with. Writes to the scope-appropriate location and archives the previous version. This is the write surface for session handoffs — /whats-next is the read surface that consumes these artifacts.
</objective>

<process>
- Determine scope: if --client CODE is provided, target clients/{CODE}/next-session-handoff.md; if --system is provided, target _dev/reports/analysis/next-session-handoff.md; if neither, use the shared resolver (tools/planning/lib/resolve-task-plan.js) listAllTaskPlans() to identify active plans and infer scope from the most recent workstream, or ask the operator.
- If a next-session-handoff.md already exists at the target path and --no-archive is not set, move it to the archive: _dev/reports/analysis/next-session-archive/{ISO-date-time}__handoff.md (system scope) or clients/{CODE}/plans/archive/{ISO-date-time}__handoff.md (client scope). Create the archive directory on first use. The archive is preservation, not disappearance; after writing the new handoff, refresh the continuity index so prior handoffs remain referenceable.
- Gather session context: recent git log (commits since last handoff or session start), task plan states via listAllTaskPlans(), open signals in _dev/reports/signals/, goal-continuity checkpoints or debriefs for active goals, and any operator gates or blocked items.
- Write the handoff artifact with a top header followed by blockquote metadata lines `> Scope: ...` and `> Date: ...`, then the following sections in order: COMPLETED THIS SESSION (what was done, with commit refs where applicable), BLOCKED (specific blockers with reasons and who/what they are waiting on), ACTIVE PLAN STATES (plan id, status, and scope for each active plan), READY TO EXECUTE (prioritized list with exact /commands), CONTEXT NOTES (anything the next session needs to know that does not fit the above sections, including incomplete goal checkpoints, forbidden repeat actions, and other-actor surfaces to avoid), and RECOMMENDED NEXT COMMAND (single exact command to start the next session).
- The handoff artifact must use a consistent heading structure so that /whats-next and other tools can parse it as a structured input. Use level-2 markdown headings for each section name exactly as listed above.
- Refresh the continuity index with `npm run sessions:continuity` after writing any system or client handoff so active and archived handoffs remain operator-visible.
- Report the paths written: the current handoff file, the archive copy if one was created, and the continuity index path when refreshed.
</process>

<success_criteria>
- Handoff artifact written to the scope-appropriate location
- Previous version archived if one existed (unless --no-archive)
- Every active task plan and pursued in-progress goal accounted for in the ACTIVE PLAN STATES or CONTEXT NOTES section
- Blocked items include specific blockers and responsible parties
- RECOMMENDED NEXT COMMAND is a single runnable command
- Section headings and top blockquote metadata match the documented contract so /whats-next and the continuity index can consume the artifact
- Prior system and client handoffs remain discoverable through _dev/reports/analysis/next-session-continuity.md and .json
</success_criteria>

<handoff>
handoff_written: Next session starts with /whats-next to read the briefing
scope_unclear: Operator specifies --client CODE or --system
dirty_tree: /clean-house before handoff to avoid stale state in the next session
</handoff>
