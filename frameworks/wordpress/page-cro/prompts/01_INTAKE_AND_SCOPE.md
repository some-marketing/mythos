# 01: Intake and Scope

## Objective
Gather page URLs, conversion goals, traffic context, and current metrics. Confirm audit scope and establish the baseline before analysis begins.

## Mode
FINDINGS_ONLY

## Inputs
- `page_urls` from project.json (required)
- `conversion_goals` from project.json (required)
- `page_type` from project.json (required)
- `traffic_sources` (optional)
- `current_conversion_rate` (optional)
- `target_conversion_rate` (optional)
- `heatmap_data` (optional)
- `session_recordings` (optional)
- `analytics_access` (optional)

## Steps

1. [AUTO] Read project.json for page URLs, conversion goals, and page type.
2. [AUTO] Fetch each target page via browser automation to confirm accessibility and capture rendered state.
3. [AUTO] Identify page type per page (homepage, landing page, pricing, feature, blog, about, other) and note type-specific analysis considerations:
   - **Homepage**: cold visitor positioning, multiple audience paths
   - **Landing page**: message match with traffic source, single-focus conversion
   - **Pricing page**: plan comparison clarity, plan selection anxiety
   - **Feature page**: feature-to-benefit connection, try/buy path
   - **Blog post**: contextual CTA relevance, inline CTA placement
4. [AUTO] Document available data sources:
   - Current conversion rate and baseline metrics (if provided)
   - Traffic source breakdown (if provided)
   - Heatmap or session recording data (if provided)
   - Post-click flow details (what happens after conversion action)
5. [GATE] Confirm audit scope with operator:
   - Which pages to analyze (all provided or subset)
   - Primary conversion goal per page
   - Available behavioral data sources
   - Any prior CRO work or A/B tests already run
6. [AUTO] Write intake summary to `outputs/page-cro/intake-summary.md`.

## Outputs
- `outputs/page-cro/intake-summary.md` containing:
  - Page URLs with confirmed accessibility status
  - Page type classification per URL
  - Primary conversion goal per page
  - Traffic source context (if available)
  - Current conversion metrics (if available)
  - Available data sources inventory
  - Confirmed audit scope
  - Type-specific considerations to check in subsequent prompts

## Success Criteria
- [ ] All target page URLs are accessible (HTTP 200 or valid redirect)
- [ ] Page type classified for each URL
- [ ] Conversion goals documented per page
- [ ] Audit scope confirmed with operator
- [ ] Intake summary written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific constraints: no site modifications, no form submissions, no CTA interactions
- Do not begin analysis in this prompt — intake and scoping only
