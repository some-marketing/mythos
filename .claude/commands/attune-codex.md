---
description: Attune the codex — sync project-claude.yml with assets on disk
allowed-tools: [Read, Glob, Grep, Bash]
---

> Authority: `sync-manifest` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Attune the codex (sync the manifest): scan all Claude assets on disk (essences/skills, commands, familiars/agents, guardrails) and update `.claude/project-claude.yml` to match. Prevents manifest drift between the requirements source and actual project state.
</objective>

<process>
1. **Run sync script:** `node tools/verify/sync-manifest.cjs`
2. **Review output:** Report what changed (additions, removals, count updates).
3. **Verify result:** `node tools/verify/sync-manifest.cjs --check` should return PASS.
</process>

<success_criteria>
- project-claude.yml reflects all system and grimoire assets on disk
- `npm run manifest:check` exits 0
- No orphaned or missing entries remain
</success_criteria>
