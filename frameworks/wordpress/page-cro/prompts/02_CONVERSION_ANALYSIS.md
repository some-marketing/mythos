# 02: Conversion Analysis

## Objective
Analyze each target page across the 7 CRO dimensions in order of impact. Produce a structured conversion analysis report with evidence-backed observations.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/page-cro/intake-summary.md` from Prompt 01
- Target page URLs and page types from intake
- Heatmap or session recording data (if available)

## Steps

1. [AUTO] Load each target page via browser automation to assess rendered state, visual hierarchy, and interactive elements.

2. [AUTO] **Value Proposition Clarity** (Highest Impact) per page:
   - Can a visitor understand what this is and why they should care within 5 seconds?
   - Is the primary benefit clear, specific, and differentiated?
   - Is it written in the customer's language (not company jargon)?
   - Flag: feature-focused instead of benefit-focused messaging
   - Flag: vague or overly clever copy that sacrifices clarity
   - Flag: attempting to communicate too many things at once

3. [AUTO] **Headline Effectiveness** per page:
   - Does the headline communicate the core value proposition?
   - Is it specific enough to be meaningful (numbers, timeframes, concrete details)?
   - Does it match the traffic source's messaging (if traffic sources are known)?
   - Assess against strong patterns: outcome-focused, specificity-driven, social-proof-led

4. [AUTO] **CTA Placement, Copy, and Hierarchy** per page:
   - Is there one clear primary action?
   - Is the primary CTA visible without scrolling?
   - Does button copy communicate value, not just action? (e.g., "Start Free Trial" vs. "Submit")
   - Is there a logical primary vs. secondary CTA structure?
   - Are CTAs repeated at key decision points throughout the page?

5. [AUTO] **Visual Hierarchy and Scannability** per page:
   - Can someone scanning get the main message without reading everything?
   - Are the most important elements visually prominent?
   - Is there sufficient white space to guide attention?
   - Do images support or distract from the message?
   - Is the reading flow logical (F-pattern or Z-pattern alignment)?

6. [AUTO] **Trust Signals and Social Proof** per page:
   - Inventory present trust elements: customer logos, testimonials, case studies, review scores, security badges
   - Assess specificity: are testimonials attributed with names, roles, and photos?
   - Assess placement: are trust signals near CTAs and after benefit claims?
   - Flag: generic or unattributed social proof
   - Flag: trust signals present but buried below the fold

7. [AUTO] **Objection Handling** per page:
   - Are common objections addressed? (price/value, "will this work for me?", implementation difficulty, "what if it doesn't work?")
   - Check for: FAQ sections, guarantees, comparison content, process transparency
   - Flag: major objections left unaddressed
   - Flag: objection handling present but poorly placed (too far from decision point)

8. [AUTO] **Friction Points** per page:
   - Check form fields (too many, unclear labels, unnecessary required fields)
   - Assess clarity of next steps after CTA
   - Check for confusing navigation or competing actions
   - Test mobile experience (responsive layout, tap targets, form usability)
   - Note page load performance observations
   - Flag: any step where the visitor might hesitate or abandon

9. [AUTO] Write findings to `outputs/page-cro/conversion-analysis.md`.

## Outputs
- `outputs/page-cro/conversion-analysis.md` with per-page findings across all 7 dimensions, each containing:
  - **Observation**: What was observed
  - **Impact**: HIGH_IMPACT / MEDIUM_IMPACT / LOW_IMPACT / INFORMATIONAL
  - **Evidence**: Page URL + specific element, screenshot reference, or behavioral data
  - **Dimension**: Which of the 7 CRO dimensions this falls under
  - Section headers per page, subsections per dimension

## Success Criteria
- [ ] All 7 CRO dimensions assessed for every target page
- [ ] Every observation cites specific evidence (element, location, screenshot)
- [ ] Impact levels assigned consistently across pages
- [ ] Page-type-specific considerations from intake are reflected in analysis
- [ ] Observations use "was observed" / "appears to" language, not "is broken" / "is wrong"
- [ ] No recommendations in this prompt — analysis and observations only

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: read and observe only, no site modifications, no form submissions
- Do not interact with CTAs or conversion flows — observe their state only
- Do not make recommendations in this prompt — that is Prompt 03's job
- Mobile assessment via viewport resize, not separate m. site testing
