# Audit Framework Workflow

## Steps

1. **[AUTO] Read manifest.json** — Parse and validate structure
2. **[AUTO] Check prompt chain** — Verify all numbered prompts exist and chain correctly
3. **[AUTO] Validate schemas** — Ensure all referenced schemas parse as valid JSON Schema
3a. **[AUTO] Check output contract** — If manifest has output_contract_v2:
    - Verify schemas/output/ directory exists
    - Verify each schema_ref in output_contract_v2 resolves to an existing file
    - Verify each bundle_type has non-empty required_files
    If manifest only has output_contract (v1): emit info finding noting typed contract is available
4. **[AUTO] Check guardrails** — Verify guardrails.md exists and covers all declared execution modes
5. **[AUTO] Validate skills** — Check all SKILL.md files have proper YAML frontmatter and XML structure
6. **[AUTO] Validate commands** — Check all command .md files have description in frontmatter
7. **[AUTO] Validate agents** — Check all agent .md files have name, description, tools in frontmatter
8. **[AUTO] Cross-reference check** — Verify manifest references match actual files
9. **[AUTO] Report** — Generate audit report with PASS/FAIL per check

## Output
Audit report with:
- Framework: {service}/{name}
- Checks: [list of PASS/FAIL]
- Issues: [list of problems found]
- Suggestions: [list of improvements]
