---
description: Regenerate skills, commands, and agents when source prompts change
allowed-tools: Task
---

<objective>
Invoke the framework/update-framework-artifacts skill to scan all source prompts
and regenerate the corresponding skills, commands, and agent configurations to
keep them in sync.

No arguments required -- the skill scans all prompts automatically.
</objective>

<context>
This is a meta-command that maintains the framework itself. When source prompts in
frameworks/wordpress/qa/prompts/ are modified, added, or removed, the derived artifacts (skills,
commands, agents) may become stale. This command detects drift and regenerates
affected files.

Artifacts managed:
- frameworks/wordpress/qa/.claude/skills/qa/*/SKILL.md
- frameworks/wordpress/qa/.claude/commands/qa/*.md
- frameworks/wordpress/qa/.claude/agents/qa/*.md
- CLAUDE.md registration tables
</context>

<process>
1. **Confirmation gate**: Confirm with the user: "This will regenerate skills, commands, and agents from source prompts. Proceed?"

2. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/update-framework-artifacts/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.

3. The skill will:
   a. Scan frameworks/wordpress/qa/prompts/ for all numbered prompt files
   b. Scan frameworks/wordpress/qa/.claude/skills/qa/ for existing skill definitions
   c. Scan frameworks/wordpress/qa/.claude/commands/qa/ for existing command definitions
   d. Scan frameworks/wordpress/qa/.claude/agents/qa/ for existing agent definitions
   e. Identify drift: new prompts without artifacts, modified prompts with
      stale artifacts, removed prompts with orphaned artifacts
   f. Regenerate affected skill, command, and agent files
   g. Update CLAUDE.md registration tables if needed
   h. Report what was created, updated, or flagged for removal
</process>

<success_criteria>
- Skill framework/update-framework-artifacts successfully invoked
- All source prompts scanned
- Drift detection completed (new, stale, orphaned)
- Affected artifacts regenerated
- CLAUDE.md registrations updated if needed
- Summary of changes reported to user
</success_criteria>
