---
description: Create a structured design brief bridging competitive audit to mockup creation
argument-hint: "<client> <page> <site-url>"
allowed-tools: [Read, Write, Grep, Glob]
---

<objective>
Produce a structured design brief (mockup_brief.json + spec skeleton) by invoking the
`design-research/mockup-brief` skill. Bridges competitive audit evidence to actionable
mockup specifications.
</objective>

<process>
1. **Parse arguments**
   - Extract `CLIENT`, `PAGE`, and `SITE_URL` from `$ARGUMENTS`.
   - If any are missing, prompt the user.

2. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/mockup-brief/SKILL.md`
   - Follow the skill's automated workflow: load audit evidence, extract brand tokens,
     analyze patterns, confirm with user, generate brief + spec skeleton.

3. **Deliver results**
   - Present brief path and summary (adopted/skipped/open counts).
   - Present spec skeleton path.
   - Suggest next step: `/design-mockup <client> <page> <url>`.
</process>

<success_criteria>
- mockup_brief.json is valid JSON with all required fields
- Every pattern decision has source and rationale
- Brand tokens extracted from live site
- Spec skeleton has all sections pre-populated
</success_criteria>
