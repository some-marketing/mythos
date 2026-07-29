---
description: Run full docgen pipeline - capture screenshots then write to Notion
argument-hint: [client-code]
allowed-tools: [Read, Write, Grep, Glob, browser_navigate, browser_snapshot, browser_click, browser_type, browser_take_screenshot, browser_press_key, browser_evaluate, mcp__claude_ai_Notion__notion-fetch, mcp__claude_ai_Notion__notion-update-page, mcp__claude_ai_Notion__notion-search]
---

<context>
Skill: `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` (full workflow)
Guardrails: `frameworks/wordpress/documentation/guardrails.md`
Mode: PATCH_ALLOWED (coordinator: capture then write-notion)
This command runs capture(all) followed by write-notion(all) in sequence.
Stops between phases if blockers are found.

Pre-flight check:
!`[ -f clients/$1/config.json ] && echo "Config found" || echo "Config missing — run setup first"`
</context>

<objective>
Run full docgen pipeline (capture screenshots then write to Notion) by invoking the `documentation` skill with the `full` workflow.
</objective>

<process>
1. [USER] Parse $ARGUMENTS for client_code. If missing, ask. **STOP and wait for response.**
2. Read the skill at `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` and follow the full workflow.
3. Run capture(all) followed by write-notion(all) in sequence.
</process>

<success_criteria>
- All guides captured with screenshots and drift detection
- Guide content written to Notion portal pages
- Config updated with timestamps for both capture and write phases
</success_criteria>
