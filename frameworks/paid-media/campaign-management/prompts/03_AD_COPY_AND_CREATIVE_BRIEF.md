# 03: Ad Copy and Creative Brief

## Objective
Generate ad copy variations (headlines, descriptions, CTAs) per ad group/set from the approved campaign structure, and create a creative brief for visual assets. All copy is for operator review before platform entry.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/campaign-management/intake-and-audit.md` from Prompt 01
- `outputs/campaign-management/campaign-structure.md` from Prompt 02
- `landing_page_urls` (optional) — for message match alignment

## Steps

1. [AUTO] **Ad copy framework selection** per ad group/set:
   - Match copy framework to funnel position and audience temperature:
     - Problem-Agitate-Solve (PAS): cold audiences, pain-point driven
     - Before-After-Bridge (BAB): consideration stage, transformation messaging
     - Social Proof Lead: warm audiences, credibility-driven
     - Feature-Benefit Bridge: product-aware audiences
     - Direct Response: bottom-of-funnel, clear offers

2. [AUTO] **Headline generation** per ad group/set:
   - **Google Search Ads** (30 char limit per headline, up to 15 headlines):
     - Include primary keyword naturally
     - Use formulas: [Keyword] + [Benefit], [Action] + [Outcome], [Number] + [Benefit]
     - Include numbers and stats when possible
     - Provide at least 8-10 headline variations per ad group
   - **Meta Ads** (40 char headline recommended):
     - Outcome hooks, curiosity hooks, contrarian hooks, question hooks
     - Front-load the hook
     - Provide at least 3-5 headline variations per ad set
   - **LinkedIn Ads** (70 char headline recommended):
     - Professional tone, specific job outcomes
     - Stats and social proof emphasis
     - Provide at least 3-5 headline variations per ad set
   - Skip platforms not in scope

3. [AUTO] **Description / primary text generation** per ad group/set:
   - **Google Search Ads** (90 char limit per description, up to 4):
     - Reinforce headline benefit with proof point
     - Include CTA in at least one description
     - Provide 3-4 description variations per ad group
   - **Meta Ads** (125 char visible, can be longer):
     - Apply selected copy framework (PAS, BAB, etc.)
     - Hook in the first line (it may be all that displays)
     - Provide 2-3 primary text variations per ad set
   - **LinkedIn Ads** (150 char recommended, 600 max):
     - Professional but not boring
     - Lead with specific outcomes or stats
     - Provide 2-3 intro text variations per ad set

4. [AUTO] **CTA selection** per ad group/set:
   - Match CTA to funnel position:
     - Top of funnel (awareness): Learn More, See How It Works, Watch Demo
     - Middle of funnel (consideration): Get the Guide, See Examples, Read Case Study
     - Bottom of funnel (conversion): Start Free Trial, Book a Demo, Get Started Free
   - Note platform-specific CTA button options (Meta and LinkedIn have preset CTA buttons)

5. [AUTO] **Ad extensions / assets** (Google Ads):
   - Sitelinks: 4-6 relevant pages with descriptions
   - Callouts: key benefits and offers
   - Structured snippets: features, types, services
   - Call extension (if phone leads are valuable)
   - Image extensions (if available)

6. [AUTO] **Creative brief for visual assets:**
   - Define image specifications per platform:
     - Feed: 1080x1080 (1:1)
     - Stories/Reels: 1080x1920 (9:16)
     - Landscape: 1200x628 (1.91:1)
     - LinkedIn single image: 1200x627 (1.91:1) or 1080x1080
   - Recommend creative approaches:
     - Clear product screenshots showing UI (SaaS)
     - Before/after comparisons
     - Stats and numbers as focal point
     - Human faces (real, not stock)
     - Bold, readable text overlay (keep under 20%)
   - Video brief (if applicable):
     - Hook (0-3 sec): pattern interrupt, question, or bold statement
     - Problem (3-8 sec): relatable pain point
     - Solution (8-20 sec): show product/benefit
     - CTA (20-30 sec): clear next step
     - Always include captions (85% watch without sound)
     - Native feel outperforms polished production
   - Define creative testing hierarchy:
     1. Concept/angle (biggest impact)
     2. Hook/headline
     3. Visual style
     4. Body copy
     5. CTA

7. [GATE] Present all ad copy and creative brief to operator for review. Note:
   - All copy is a recommendation until operator approves
   - Operator should verify brand voice alignment
   - Operator should check compliance requirements (special ad categories, industry regulations)

8. [AUTO] Write ad copy and creative brief to `outputs/campaign-management/ad-copy-and-creative-brief.md`.

## Outputs
- `outputs/campaign-management/ad-copy-and-creative-brief.md` containing:
  - Ad copy organized by ad group/set, with headlines, descriptions, and CTAs
  - Copy framework used for each ad group/set noted
  - Platform-specific formatting and character count compliance
  - Ad extension recommendations (Google Ads)
  - Creative brief: image specs, recommended approaches, video brief (if applicable)
  - Creative testing hierarchy and priority

## Success Criteria
- [ ] Ad copy provided for every ad group/set in the approved structure
- [ ] Headlines respect platform character limits
- [ ] Descriptions respect platform character limits
- [ ] CTAs match funnel position
- [ ] At least 2-3 copy variations per ad group/set for testing
- [ ] Creative brief includes image specs for all relevant placements
- [ ] Copy frameworks are appropriate for audience temperature
- [ ] Platform-specific formatting noted (Google extensions, Meta CTA buttons, LinkedIn tone)
- [ ] Operator reviewed and approved before finalization

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: generate recommendations for operator review; no platform submissions
- Ad copy is a suggestion — operator confirms brand voice and compliance
- Do not fabricate testimonials, stats, or social proof; use placeholders like "[Customer name], [Title]" if real data is unavailable
- Note special ad category requirements if applicable (housing, credit, employment, politics on Meta)
- Creative briefs describe intent and direction, not final production assets
