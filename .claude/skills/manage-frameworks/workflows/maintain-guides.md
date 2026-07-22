# Maintain Workflow Guides

Keep framework WORKFLOW_GUIDE templates in sync with current commands, arguments, and troubleshooting content.

## When to Run

- After `improve-framework` applies changes (step 6)
- After `update-framework` regenerates QA artifacts
- After `create-framework` generates skills/commands/agents (step 9)

## Steps

1. **[AUTO] Scan current commands** — Read all `.md` files in `frameworks/{service}/{framework}/.claude/commands/{name}/`. Extract: command name, argument-hints, description, execution mode.

2. **[AUTO] Read current guide template** — Load `frameworks/{service}/{framework}/templates/WORKFLOW_GUIDE.template.md`. If it doesn't exist, copy from `frameworks/_template/skeleton/templates/WORKFLOW_GUIDE.template.md` and populate with framework basics.

3. **[AUTO] Diff commands vs guide** — Compare the scanned command list against the guide's Command Quick Reference table. Identify:
   - New commands not in the guide
   - Removed commands still listed in the guide
   - Changed argument signatures (argument-hints differ)
   - Changed execution modes

4. **[AUTO] Scan troubleshooting sources** — Read `frameworks/{service}/{framework}/docs/` for failure modes, common issues, and operational notes. Check for new troubleshooting-relevant content not reflected in the guide's Troubleshooting section.

5. **[USER] Propose updates** — Present a summary of proposed guide changes:
   - Commands to add/remove/update in the Quick Reference table
   - New or updated Step-by-Step entries for significant new commands
   - New Troubleshooting entries based on docs content
   - Any stale references to remove

6. **[AUTO] Apply approved updates** — Update `templates/WORKFLOW_GUIDE.template.md` with the approved changes. Preserve existing structure and voice.

## Output

- Updated `frameworks/{service}/{framework}/templates/WORKFLOW_GUIDE.template.md`
- Summary of changes made

## Notes

- This workflow does NOT modify rendered `WORKFLOW_GUIDE.md` files in client project directories. Those are generated at project creation time and are not auto-updated.
- The guide template uses `{{VARIABLES}}` that get populated during project creation: `CLIENT_NAME`, `CLIENT_CODE`, `PROJECT_NAME`, `SERVICE`, `FRAMEWORK`.
- Keep the guide voice human-readable. Avoid LLM-facing jargon. Write for the operator, not the agent.
