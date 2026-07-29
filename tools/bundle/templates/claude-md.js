/**
 * CLAUDE.md template for handoff bundles.
 */

/**
 * @param {string} scope - Human-readable scope description
 * @returns {string} CLAUDE.md content
 */
export function claudeMd(scope) {
  return `# Claude Context — {DEVELOPER_NAME} Handoff Bundle

## Scope
This bundle contains payload analysis for ${scope}. The developer ({DEVELOPER_NAME}) owns the PHP backend and CRM integration.

## Start Here
1. Read \`LLM_MANIFEST.json\` for bundle metadata
2. Read \`For_{DEVELOPER_NAME}.md\` for the observation summary
3. Read \`QUESTIONS_FOR_DEVELOPER.md\` for items needing developer input

## Key Rules
- Reporting is **observational only** — no diagnoses, no code suggestions
- All interpretive statements must use "HYPOTHESIS:" label with evidence citations
- Changelog is a **post-fix deliverable** — developer generates after implementing fixes
- Raw artifacts in \`raw/\` are verbatim copies — never modify them
`;
}

export default { claudeMd };
