---
description: Walk through WordPress admin and capture guide screenshots with drift detection
argument-hint: [client-code] [guide-slug|all]
allowed-tools: [Read, Write, Grep, Glob, browser_navigate, browser_snapshot, browser_click, browser_type, browser_take_screenshot, browser_press_key, browser_evaluate]
---

<context>
Skill: `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` (capture workflow)
Source prompt: `frameworks/wordpress/documentation/prompts/01_MCP_WALKTHROUGH_CAPTURE.md`
Guardrails: `frameworks/wordpress/documentation/guardrails.md`
Mode: PATCH_ALLOWED (writes screenshots and step logs only — no live site changes)

Pre-flight check:
!`[ -f clients/$1/config.json ] && echo "Config found" || echo "Config missing — run setup first"`
</context>

<objective>
Walk through WordPress admin and capture guide screenshots with drift detection by invoking the `documentation` skill with the `capture` workflow.
</objective>

<process>
1. [USER] Parse $ARGUMENTS for client_code and guide_slug. If either is missing, ask. **STOP and wait for response.**
2. Read the skill at `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` and follow the capture workflow.
3. Load client config and guide definitions.
4. Log in to WordPress admin via Playwright MCP.
5. Walk each guide step, capture screenshots, detect drift.
6. Write step logs and drift reports.
7. Update config with last_capture timestamp.
</process>

<success_criteria>
- All guide steps walked and screenshots captured
- Drift detection completed with reports generated
- Config updated with last_capture timestamp
</success_criteria>
