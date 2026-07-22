---
description: Show capture progress for a site audit (which sites done/pending/blocked)
argument-hint: "[base-path]"
allowed-tools: Read, Bash, Glob
---

<objective>
Display a status table showing capture progress for all sites in a competitive
audit. Shows which sites are done, pending, or blocked, with phase-level detail.
</objective>

<process>
1. **Parse arguments**
   - Extract `base-path` from `$ARGUMENTS`.
   - If missing, prompt the user for the base path containing sites.json.

2. **Read sites.json**
   - Load the site definitions to know which sites are expected.

3. **Check per-site status**
   - For each site in sites.json, look for `sites/<slug>/derived/meta.json`.
   - If meta.json exists, read phase completion status.
   - If meta.json is missing, check for evidence/ directory existence.
   - Classify each site as: COMPLETE, PARTIAL (with phases done/total), or PENDING.

4. **Check cross-site artifacts**
   - Check for FEATURE_MATRIX.md and COMPETITIVE_SUMMARY.md at base path.
   - Check for verify_audit.cjs results.

5. **Display status table**
   Present a table with columns:
   - Site slug
   - Site name
   - Status (COMPLETE / PARTIAL / PENDING)
   - Phases completed (e.g., 6/6, 3/6, 0/6)
   - Errors (if any from meta.json)

   Below the table, show:
   - Cross-site artifacts: present/missing
   - Verification: PASS/FAIL/NOT_RUN
   - Suggested next action based on current state
</process>

<context>
Skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md`
Mode: REVIEW_ONLY — reads meta.json and evidence files, no modifications.
</context>

<success_criteria>
- Status table displayed for all sites in sites.json
- Phase-level detail shown for partial captures
- Cross-site artifact status reported
- Suggested next action provided
</success_criteria>
