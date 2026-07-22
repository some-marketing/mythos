---
description: Generate cross-site analysis from existing captured evidence
argument-hint: "[base-path]"
allowed-tools: Task
---

<objective>
Generate cross-site comparison artifacts from previously captured evidence. This
runs the analysis portion of the `design-research/site-audit` skill without re-capturing.
Use when evidence already exists and you need to (re-)generate the feature matrix
and competitive summary.
</objective>

<process>
1. **Parse arguments**
   - Extract `base-path` from `$ARGUMENTS`.
   - If missing, prompt the user for the base path containing sites/ directory.

2. **Discover existing evidence**
   - Read sites.json from the base path.
   - For each site, verify that `sites/<slug>/evidence/` contains expected artifacts.
   - Report any sites with missing evidence (they will be excluded from analysis).

3. **Invoke the skill (analysis steps only)**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
   - Execute steps 3-5 of the `<automated_workflow>`:
     - Step 3: Per-site analysis (site_analysis.json + site_analysis.md)
     - Step 4: Cross-site synthesis (FEATURE_MATRIX.md + COMPETITIVE_SUMMARY.md)
     - Step 5: Run verify_audit.cjs

4. **Deliver analysis**
   - Present the feature matrix and competitive summary.
   - Report any sites excluded due to missing evidence.
   - Provide file paths for all generated artifacts.
</process>

<context>
Skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
Mode: REVIEW_ONLY — reads existing evidence, writes analysis reports.
Scope: Analysis and synthesis only. No browser interaction.
</context>

<success_criteria>
- Per-site site_analysis.json and site_analysis.md generated for all sites with evidence
- FEATURE_MATRIX.md and COMPETITIVE_SUMMARY.md generated at base path
- verify_audit.cjs passes for included sites
- Missing-evidence sites clearly reported
</success_criteria>
