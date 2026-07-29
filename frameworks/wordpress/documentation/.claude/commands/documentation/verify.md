---
description: Re-walk a written guide in the browser to verify accuracy (FINDINGS_ONLY)
argument-hint: [client-code] [guide-slug|all]
allowed-tools: [Read, Glob, Grep, browser_navigate, browser_snapshot, browser_click, browser_take_screenshot]
---

<context>
Skill: `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` (verify workflow)
Source prompt: `frameworks/wordpress/documentation/prompts/03_VERIFY_GUIDE_VIA_MCP.md`
Guardrails: `frameworks/wordpress/documentation/guardrails.md`
Mode: FINDINGS_ONLY — observe and report only. No writes, no patches, no Notion updates.
</context>

<objective>
Re-walk a written guide in the browser to verify accuracy by invoking the `documentation` skill with the `verify` workflow.
</objective>

<process>
1. [USER] Parse $ARGUMENTS for client_code and guide_slug. If either is missing, ask. **STOP and wait for response.**
2. Read the skill at `frameworks/wordpress/documentation/.claude/skills/documentation/SKILL.md` and follow the verify workflow.
3. Walk each guide step in the browser, comparing against written content.
4. Record any discrepancies as findings.
</process>

<success_criteria>
- All guide steps re-walked in browser
- Discrepancies between written content and live site identified
- Findings report generated
- Mode: FINDINGS_ONLY enforced — no modifications permitted
</success_criteria>
