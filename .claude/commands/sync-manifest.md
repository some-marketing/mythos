---
description: Sync project-claude.yml with assets on disk
mode: PATCH_ALLOWED
---

<objective>
Scan all Claude assets on disk (skills, commands, agents, guardrails) and update .claude/project-claude.yml to match, preventing manifest drift between the requirements source and actual project state.
</objective>

<process>
- Run the sync script: node tools/verify/sync-manifest.cjs to detect and apply changes.
- Review the output and report what changed: additions, removals, and count updates.
- Verify the result by running node tools/verify/sync-manifest.cjs --check, which should return PASS.
- If verification fails, diagnose the remaining drift and re-run sync or apply manual corrections.
</process>

<success_criteria>
- project-claude.yml reflects all system and framework assets on disk
- npm run manifest:check exits 0
- No orphaned or missing entries remain
</success_criteria>

<handoff>
sync_complete: validate-all-frameworks
persistent_drift: review-progress
</handoff>
