# 03: Recommendations

## Objective
Synthesize the conversion analysis into prioritized recommendations: quick wins, high-impact changes, copy alternatives, and items better suited for testing. This is the primary actionable deliverable.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/page-cro/intake-summary.md` from Prompt 01
- `outputs/page-cro/conversion-analysis.md` from Prompt 02

## Steps

1. [AUTO] **Aggregate observations** from Prompt 02:
   - Count observations by impact level (HIGH_IMPACT, MEDIUM_IMPACT, LOW_IMPACT, INFORMATIONAL)
   - Group by CRO dimension across all pages
   - Identify patterns that appear across multiple pages

2. [AUTO] **Build Quick Wins section** — changes that can be implemented within 1-2 hours with likely immediate benefit:
   - CTA copy improvements (action-oriented, value-communicating alternatives)
   - Missing or weak meta elements visible to visitors
   - Trust signal repositioning (moving existing elements to higher-impact locations)
   - Form field reduction or label clarification
   - Mobile-specific fixes (tap targets, layout issues)
   - For each: state the observation, the proposed change, and why it may help

3. [AUTO] **Build High-Impact Changes section** — changes requiring more effort but addressing HIGH_IMPACT observations:
   - Value proposition rewrites with benefit-focused alternatives
   - Page structure reorganization (visual hierarchy, information flow)
   - New trust signal additions (testimonials, case studies, social proof)
   - Objection handling additions (FAQ, guarantees, comparison content)
   - CTA hierarchy restructuring
   - For each: state the observation, the proposed change, estimated effort, and expected benefit framed as hypothesis

4. [AUTO] **Build Copy Alternatives section** — for key text elements, provide 2-3 testable variations:
   - Headlines: 2-3 alternatives with rationale per variation
   - CTAs: 2-3 button copy alternatives with rationale
   - Subheadlines: alternatives where the current version lacks clarity or specificity
   - Value proposition statements: alternatives where current messaging is feature-focused
   - For each set: explain the strategic difference between variations (not just word changes)

5. [AUTO] **Build Test Ideas section** — observations where the right answer is uncertain and testing is warranted:
   - Items where two reasonable approaches exist
   - Changes that carry risk (pricing display, navigation removal, major layout shifts)
   - High-traffic elements where even small improvements compound
   - For each: frame as "Hypothesis: [change] may [outcome] because [reasoning]"

6. [GATE] Present recommendations summary to operator for review:
   - Quick wins count and estimated implementation time
   - High-impact changes count and effort overview
   - Number of copy alternative sets produced
   - Test ideas that should feed into Prompt 04

7. [AUTO] Write recommendations to `outputs/page-cro/recommendations.md`.

## Outputs
- `outputs/page-cro/recommendations.md` containing:
  - **Quick Wins**: actionable changes with observation, proposed change, and rationale
  - **High-Impact Changes**: larger changes with observation, proposal, effort estimate, and hypothesis
  - **Copy Alternatives**: 2-3 variations per key element with strategic rationale
  - **Test Ideas**: hypotheses worth validating through experimentation
  - Summary statistics: observation counts by impact and dimension

## Success Criteria
- [ ] All HIGH_IMPACT and MEDIUM_IMPACT observations from Prompt 02 addressed
- [ ] Every recommendation traces back to a specific observation from the analysis
- [ ] Quick wins are genuinely quick (implementable in 1-2 hours)
- [ ] Copy alternatives provide strategic rationale, not just word swaps
- [ ] Recommendations use "this may improve" language, not "this will fix"
- [ ] No new analysis introduced — this prompt synthesizes existing observations
- [ ] Operator has reviewed the recommendations summary

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: synthesize existing analysis only; no new data collection or site interaction
- Never guarantee conversion improvements or claim specific lift percentages
- Never present copy alternatives as objectively superior — frame as testable variations
- Recommendations that carry risk (pricing changes, navigation removal, trust signal changes) must flag the tradeoff explicitly
- Do not recommend removing page elements without stating what may be lost
