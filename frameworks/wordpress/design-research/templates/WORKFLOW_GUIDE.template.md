# Design Research Workflow — {{CLIENT_NAME}} ({{CLIENT_CODE}})

Project: `{{PROJECT_NAME}}`
Framework: WordPress Design Research (Perplexity AI prompt generation)

---

## What This Does

Collects information about your client's business, brand, audience, and design preferences, then generates a research prompt ready to paste into Perplexity AI for pre-build design research.

## Before You Start

You'll need:
- [ ] Client name and business type
- [ ] Website URL (if existing)
- [ ] Basic knowledge of: target audience, brand identity, project goals

Optional (for better results):
- [ ] Competitor URLs
- [ ] Brand guidelines or style preferences
- [ ] Testimonials or USPs

## Step-by-Step

### Step 1: Collect Client Information
**Command:** `/design-research:intake <client-name>`
**You provide:** Client name and answers to intake questions
**What happens:** Claude asks structured questions covering business identity, audience, brand, and content. Saves intake data.
**Output:** `intake.json` in the project directory

### Step 2: Generate Research Prompt
**Command:** `/design-research:generate <project-slug>`
**You provide:** Project slug from Step 1
**What happens:** Takes the intake data and fills in the research prompt template. Produces a ready-to-use Perplexity AI prompt.
**Output:** `completed_research_prompt.md`

### Step 3: Use the Prompt
Copy the generated prompt and paste it into Perplexity AI (or your preferred research tool).

## Troubleshooting

### Generated prompt is too generic
You likely provided only the minimum 7 variables. Re-run `/design-research:intake` and fill in more fields — especially competitors, USPs, and target audience details.

### Intake asks questions I can't answer yet
That's fine. Provide what you have — the minimum viable tier (7 fields) will still produce a usable prompt. You can re-run intake later with more information.

---

## Variable Completeness

The more information you provide during intake, the better the research prompt:

| Tier | Variables | Quality |
|------|-----------|---------|
| Minimum Viable | 7 core fields | Basic research prompt |
| Full Intake | ~20 fields | Comprehensive prompt |
| Enhanced | All 33 fields | Maximum specificity |
