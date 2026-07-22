---
description: Generate and write guide content to Notion portal pages
argument-hint: [client-code] [guide-slug|all]
allowed-tools: [Read, Write, Grep, Glob, mcp__claude_ai_Notion__notion-fetch, mcp__claude_ai_Notion__notion-update-page, mcp__claude_ai_Notion__notion-search]
---

<context>
Skill: `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` (write-notion workflow)
Source prompt: `frameworks/wordpress/documentation/prompts/02_DRAFT_GUIDE_FROM_STEP_LOG.md`
Guardrails: `frameworks/wordpress/documentation/guardrails.md`
Mode: PATCH_ALLOWED (updates Notion guide pages — content body only)
Critical: Notion updates replace content body only. NEVER modify page title, parent, or structure.

Pre-flight check:
!`ls clients/$1/outputs/step_logs/ 2>/dev/null | head -5 || echo "No step logs found — run capture first"`
</context>

<objective>
Generate and write guide content to Notion portal pages by invoking the `documentation` skill with the `write-notion` workflow.
</objective>

<process>
1. [USER] Parse $ARGUMENTS for client_code and guide_slug. If either is missing, ask. **STOP and wait for response.**
2. Read the skill at `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` and follow the write-notion workflow.
3. Load capture artifacts (step logs, drift reports).
4. Generate site-specific guide content with drift adaptations.
5. Write to Notion pages via notion-update-page.
6. Update config with last_notion_update timestamp.
</process>

<success_criteria>
- Guide content generated from capture artifacts
- Notion pages updated with site-specific content
- Config updated with last_notion_update timestamp
</success_criteria>
