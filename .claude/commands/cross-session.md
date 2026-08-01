---
description: Cross a session boundary as one motion — run /shutdown, drop a boundary marker, prompt the operator to start a new session with /new-session
mode: COORDINATOR
---

<objective>
Orchestrate a full session crossing by running shutdown, writing a boundary marker for the next session, and prompting the operator to clear the context.
</objective>

<process>
- Resolve scope from arguments (--client CODE or --system).
- Step 1 — Invoke /shutdown: Run canonical shutdown cascade. Halt if gates reject or errors occur.
- Step 2 — Refresh continuity index for system scope: run `npm run sessions:continuity` after the handoff is written so active and archived handoffs remain referenceable.
- Step 3 — Write boundary marker: Pipe the marker JSON to `node tools/sessions/write-boundary.cjs -` (or pass a payload file path). Markers are now PER-SCOPE files at _dev/state/session-boundary/pending/<scope>.json — the writer handles the atomic temp+validate+rename. Required fields: schema ("SessionBoundary/1.0"), scope, handoff_path, recommended_next_command; optional: summary, written_by. Multiple scopes coexist, so do NOT overwrite or worry about clobbering another live session's marker — each scope gets its own file (this replaced the old single-file race). Recommended: include a one-line `summary`. The writer exits non-zero on an invalid payload.
- Step 4 — Prompt operator: Print three-line block naming handoff, next command, and instruction to run /new-session. Note that on the next session SessionStart LISTS all pending scopes (non-destructive); the chosen scope is consumed by /new-session (or manually) via `node tools/sessions/consume-boundary.cjs <scope>`.
</process>

<success_criteria>
- /shutdown ran end-to-end or reported halt
- Per-scope boundary marker exists at _dev/state/session-boundary/pending/<scope>.json, carries "schema": "SessionBoundary/1.0", and the SessionStart lister would surface it
- System cross-session handoffs refresh _dev/reports/analysis/next-session-continuity.md and .json so archived work remains visible
- Existing markers for OTHER scopes remain intact (no clobber)
- Operator sees explicit instruction to run /new-session
- Marker contains non-placeholder handoff path and next command
</success_criteria>
