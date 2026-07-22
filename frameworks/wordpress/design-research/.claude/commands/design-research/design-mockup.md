---
description: Create HTML design mockups with live site chrome extraction and spec sync
argument-hint: "<client> <page> <site-url>"
allowed-tools: Task
---

<objective>
Create and maintain HTML design mockups informed by competitive audit data by invoking
the `design-research/design-mockup` skill. Produces standalone preview files, maintains
a living design spec, and audits all artifacts for consistency.
</objective>

<process>
1. **Parse arguments**
   - Extract `CLIENT`, `PAGE`, and `SITE_URL` from `$ARGUMENTS`.
   - If any are missing, prompt the user.

2. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/design-mockup/SKILL.md`
   - Follow the skill's automated workflow: gather inputs, extract chrome via Playwright MCP,
     build raw element mockups, generate fullpage previews, sync spec, run audit.

3. **Deliver results**
   - Present file paths for all mockup artifacts.
   - Report audit results (PASS/FAIL per check).
   - Present open questions from spec.
</process>

<success_criteria>
- All mockup files follow naming convention
- Raw elements are self-contained for DevTools paste
- Fullpage previews render in browser with site chrome
- Spec document matches mockup CSS values
- Audit passes all checks
</success_criteria>
