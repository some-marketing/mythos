/**
 * AGENTS.md template for handoff bundles.
 */

/**
 * @returns {string} AGENTS.md content
 */
export function agentsMd() {
  return `# Agents — {DEVELOPER_NAME} Handoff Bundle

## Session Bootstrap
1. Read \`LLM_MANIFEST.json\` (this directory or parent)
2. Read \`For_{DEVELOPER_NAME}.md\` for observation summary
3. Read \`QUESTIONS_FOR_DEVELOPER.md\` for items needing input

## Post-Fix Workflow
After implementing fixes, generate \`raw/dev_changelog.md\` using:
\`framework/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md\`
`;
}

export default { agentsMd };
