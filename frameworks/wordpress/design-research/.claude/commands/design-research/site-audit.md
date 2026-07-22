---
description: Run full competitive site UX/SEO audit with evidence capture and analysis
argument-hint: "[sites.json path] [site-slug|all]"
allowed-tools: Task
---

<objective>
Perform a complete competitive site audit by invoking the `design-research/site-audit` skill.
This runs the full pipeline: 6-phase browser capture for each site, per-site analysis,
cross-site feature matrix, competitive summary, and verification.
</objective>

<process>
1. **Parse arguments**
   - Extract `sites.json path` and optional `site-slug` from `$ARGUMENTS`.
   - If `site-slug` is "all" or omitted, audit all sites defined in sites.json.
   - If `sites.json path` is missing, prompt the user for it.

2. **Load site definitions**
   - Read sites.json and validate all entries have required fields (slug, name, url, inventory_path).
   - Confirm the base path for evidence output.

3. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
   - Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   - The skill navigates each site, captures 6 phases of evidence, produces
     per-site analysis, and synthesizes cross-site comparison artifacts.

4. **Deliver results**
   - Present the feature matrix and competitive summary.
   - Report verification PASS/FAIL status.
   - Provide file paths for all generated artifacts.
   - Offer next-action options (deep-dive, re-capture, presentation summary).
</process>

<context>
Skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
Mode: FINDINGS_ONLY + PATCH_ALLOWED — read-only browser, writes local evidence/reports.
</context>

<success_criteria>
- All specified sites have complete evidence and derived analysis
- FEATURE_MATRIX.md and COMPETITIVE_SUMMARY.md exist at base path
- verify_audit.cjs passes with zero missing artifacts
- No data mutated on target sites
- Results presented with file paths and top findings
</success_criteria>
