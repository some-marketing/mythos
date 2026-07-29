---
description: Capture UX/SEO evidence from a single site or all sites
argument-hint: "[sites.json path] [site-slug|all]"
allowed-tools: Task
---

<objective>
Run the 6-phase browser capture for one or more sites without producing cross-site
analysis. This is the capture-only portion of the `design-research/site-audit` skill.
Use when you need to (re-)capture evidence for specific sites before running analysis.
</objective>

<process>
1. **Parse arguments**
   - Extract `sites.json path` and optional `site-slug` from `$ARGUMENTS`.
   - If `site-slug` is "all" or omitted, capture all sites defined in sites.json.
   - If `sites.json path` is missing, prompt the user for it.

2. **Load site definitions**
   - Read sites.json and filter to the specified site(s).
   - Validate each site has required fields (slug, name, url, inventory_path).

3. **Invoke the skill (capture phases only)**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
   - Execute only steps 1-2 of the `<automated_workflow>`:
     - Step 1: Load sites.json
     - Step 2: Run 6-phase capture loop for specified site(s)
   - Write per-site evidence and meta.json files.

4. **Report capture status**
   - For each site: report phases completed, any errors encountered.
   - Provide paths to evidence directories.
   - Suggest running `/design-research:site-analyze` for cross-site synthesis.
</process>

<context>
Skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
Mode: FINDINGS_ONLY + PATCH_ALLOWED — read-only browser, writes local evidence files.
Scope: Capture only (phases 1-6 per site). No cross-site analysis.
</context>

<success_criteria>
- Specified site(s) have complete evidence directories (all 6 phases)
- meta.json written for each site with phase completion status
- No data mutated on target sites
- Capture status reported with evidence paths
</success_criteria>
