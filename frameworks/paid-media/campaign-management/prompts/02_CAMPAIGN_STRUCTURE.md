# 02: Campaign Structure

## Objective
Design the full campaign architecture including campaigns, ad groups/sets, targeting strategy, keyword/audience strategy, and bidding approach. This is the structural blueprint the operator will build in-platform.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/campaign-management/intake-and-audit.md` from Prompt 01
- Platform(s), budget, audience, and objective from intake
- `landing_page_urls` (optional)
- `historical_performance` (optional)

## Steps

1. [AUTO] **Campaign architecture design:**
   - Define campaign hierarchy following platform best practices:
     ```
     Account
     +-- Campaign 1: [Objective] - [Audience/Product]
     |   +-- Ad Set/Group 1: [Targeting variation]
     |   |   +-- Ad 1: [Creative variation A]
     |   |   +-- Ad 2: [Creative variation B]
     |   +-- Ad Set/Group 2: [Targeting variation]
     +-- Campaign 2...
     ```
   - Apply naming conventions: `[PLATFORM]_[Objective]_[Audience]_[Offer]_[Date]`
   - Recommend number of campaigns based on budget (avoid fragmenting spend across too many campaigns)
   - Separate brand vs. non-brand campaigns (Google Ads)
   - Separate prospecting vs. retargeting campaigns

2. [AUTO] **Keyword strategy** (Google Ads):
   - Identify primary keyword themes based on audience and objective
   - Recommend match types per theme:
     - Exact match for highest-intent, proven terms
     - Phrase match for moderate precision and volume
     - Broad match only with smart bidding and sufficient conversion data
   - Build negative keyword lists:
     - Universal negatives (free, jobs, careers, reviews, complaints)
     - Industry-specific negatives
     - Competitor negatives (if applicable)
   - Note RLSA opportunities if existing account has conversion data

3. [AUTO] **Audience strategy** (Meta, LinkedIn, TikTok, Twitter/X):
   - Define core audiences per ad set:
     - Interest/behavior targeting (Meta, TikTok)
     - Job title/company/industry targeting (LinkedIn)
     - Follower lookalikes and keyword targeting (Twitter/X)
   - Recommend custom audiences:
     - Website visitor segments (all visitors, key page visitors, converters for exclusion)
     - Customer list uploads (if available)
     - Engagement audiences (video viewers, page engagers)
   - Recommend lookalike audiences:
     - Source: high-LTV customers preferred over all customers
     - Size: 1-3% for initial testing, expand as data grows
   - Define exclusion lists:
     - Existing customers (unless upsell campaign)
     - Recent converters (7-14 day window)
     - Bounced visitors (<10 sec)
     - Employees (if identifiable)
   - Validate audience sizes against platform minimums

4. [AUTO] **Retargeting strategy:**
   - Design funnel-based retargeting:
     - Top: blog/content visitors -> educational messaging, social proof
     - Middle: pricing/feature page visitors -> case studies, demos
     - Bottom: cart abandoners / trial users -> urgency, objection handling
   - Define retargeting windows:
     - Hot (cart/trial): 1-7 days, higher frequency acceptable
     - Warm (key pages): 7-30 days, 3-5x/week cap
     - Cold (any visit): 30-90 days, 1-2x/week cap

5. [AUTO] **Bidding strategy recommendation:**
   - Recommend starting bid strategy based on data availability:
     - New account / no conversion data: manual CPC or cost caps
     - Some conversion data (<50 conversions): enhanced CPC or cost caps
     - Sufficient data (50+ conversions): automated bidding with target CPA/ROAS
   - Set initial bid/budget expectations based on industry benchmarks
   - Define progression path: manual -> automated as data accumulates
   - Note platform-specific bidding options and their requirements

6. [AUTO] **Budget allocation across campaigns:**
   - Allocate budget based on testing phase (first 2-4 weeks):
     - 70% to proven/safe campaigns (or highest-confidence targeting)
     - 30% to testing new audiences/creative
   - Define scaling rules:
     - Increase budgets 20-30% at a time
     - Wait 3-5 days between increases for algorithm learning
     - Consolidate into winning combinations before scaling

7. [GATE] Present campaign structure to operator for approval before proceeding to ad copy.

8. [AUTO] Write campaign structure to `outputs/campaign-management/campaign-structure.md`.

## Outputs
- `outputs/campaign-management/campaign-structure.md` containing:
  - Campaign hierarchy diagram with naming conventions
  - Keyword strategy and negative keyword lists (Google Ads)
  - Audience strategy per ad set with targeting details (social platforms)
  - Retargeting strategy with funnel stages and windows
  - Bidding strategy recommendation with progression path
  - Budget allocation plan (testing phase and scaling phase)
  - Platform-specific notes where recommendations differ

## Success Criteria
- [ ] Campaign hierarchy is clear and follows platform conventions
- [ ] Naming conventions applied consistently
- [ ] Keyword or audience strategy provided for every ad group/set
- [ ] Negative keyword or exclusion lists defined
- [ ] Retargeting strategy addresses at least 2 funnel stages
- [ ] Bidding strategy matches data availability level
- [ ] Budget allocation avoids fragmenting spend across too many campaigns
- [ ] Platform-specific recommendations labeled by platform
- [ ] Operator approved structure at gate

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: design and recommend only; no platform changes
- Audience size estimates use platform guidelines, not invented numbers
- Bidding recommendations cite data availability, not promised outcomes
- Every recommendation indicates which platform(s) it applies to
