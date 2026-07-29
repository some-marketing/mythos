---
description: Initialize a new client for WordPress documentation generation
argument-hint: [client-name]
allowed-tools: [Read, Write, Glob, Grep, mcp__claude_ai_Notion__notion-fetch, mcp__claude_ai_Notion__notion-search, mcp__claude_ai_Notion__notion-duplicate-page, mcp__claude_ai_Notion__notion-create-pages]
---

<context>
Skill: `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` (setup workflow)
Guardrails: `frameworks/wordpress/documentation/guardrails.md`
Mode: PATCH_ALLOWED (creates config, duplicates Notion portal)

Client list (if available):
!`ls clients/ 2>/dev/null | head -20 || echo "No clients directory found"`
</context>

<objective>
Initialize a new client for WordPress documentation generation by invoking the `documentation` skill with the `setup` workflow.
</objective>

<process>
1. [USER] Parse $ARGUMENTS for client_code. If missing: list available clients and ask user to provide one. **STOP and wait for response.**
2. Read the skill at `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` and follow the setup workflow.
3. Look up client in Notion database.
4. Duplicate the portal template.
5. Discover guide page IDs.
6. Detect page editor (Gutenberg vs LiveCanvas).
7. Prune irrelevant variant pages.
8. Replace placeholders with client URL.
9. Create local config.json.
</process>

<success_criteria>
- Client found in Notion database
- Portal template duplicated and configured
- Guide page IDs discovered and recorded
- Local config.json created with all settings
</success_criteria>
