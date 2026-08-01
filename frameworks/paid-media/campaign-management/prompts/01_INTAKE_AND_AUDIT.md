# 01: Intake and Audit

## Objective
Gather business context, audit the existing ad account if available, assess the competitive landscape, and confirm platform selection and budget allocation before designing campaign structure.

## Mode
FINDINGS_ONLY

## Inputs
- `platform` from project.json (required) — one or more of: Google Ads, Meta, LinkedIn, Twitter/X, TikTok
- `budget` from project.json (required) — monthly or weekly ad spend
- `target_audience` from project.json (required) — ideal customer description
- `campaign_objective` from project.json (required) — awareness, traffic, leads, sales, app installs
- `existing_account` (optional) — whether there is an active ad account to audit
- `competitor_urls` (optional) — competitor websites for landscape review
- `landing_page_urls` (optional) — destination pages for ad traffic
- `historical_performance` (optional) — past campaign data, benchmarks, or exports
- `industry` (optional) — vertical for benchmark comparison

## Steps

1. [AUTO] Read project.json for platform, budget, audience, and objective.

2. [AUTO] **Business context gathering:**
   - Document the product or service being promoted
   - Identify the primary offer (product, free trial, lead magnet, demo, etc.)
   - Confirm campaign objective aligns with business goals (not just platform default objectives)
   - Note any constraints: brand guidelines, compliance requirements, geographic restrictions

3. [AUTO] **Platform selection validation:**
   - Confirm selected platform(s) match the objective and audience
   - Flag mismatches (e.g., LinkedIn for consumer e-commerce, TikTok for B2B enterprise)
   - Reference platform selection guide:
     - Google Ads: high-intent search traffic, people actively searching for the solution
     - Meta: demand generation, visual products, creating demand with strong creative
     - LinkedIn: B2B, decision-maker targeting, higher price points
     - Twitter/X: tech audiences, timely content
     - TikTok: younger demographics (18-34), video-native content

4. [AUTO] **Existing account audit** (if `existing_account` is provided):
   - Review account structure: campaigns, ad groups/sets, naming conventions
   - Assess current performance metrics: CPA, ROAS, CTR, conversion rate
   - Identify top and bottom performing campaigns
   - Check conversion tracking status and pixel health
   - Note audience overlap or fragmentation issues
   - Flag budget allocation imbalances (too many campaigns splitting spend)

5. [AUTO] **Competitive landscape assessment** (if `competitor_urls` provided):
   - Review competitor landing pages for positioning and offers
   - Note apparent targeting strategies (keywords they likely bid on, audiences they address)
   - Identify differentiation opportunities

6. [AUTO] **Budget assessment:**
   - Document confirmed budget (monthly/weekly)
   - Assess budget adequacy for selected platform(s) and objective
   - Note platform minimums and typical CPCs for the vertical
   - Recommend budget allocation split if multiple platforms selected (e.g., 70/30)
   - Flag if budget appears insufficient for meaningful data collection on the selected platform

7. [GATE] Confirm with operator:
   - Platform selection is correct
   - Budget allocation is approved
   - Campaign objective is aligned with business goals
   - Audit scope (new build vs. optimization of existing)

8. [AUTO] Write intake and audit findings to `outputs/campaign-management/intake-and-audit.md`.

## Outputs
- `outputs/campaign-management/intake-and-audit.md` containing:
  - Business context summary (product, offer, objective, constraints)
  - Platform selection rationale and validation
  - Existing account audit findings (if applicable), with findings using HIGH_IMPACT / MEDIUM_IMPACT / LOW_IMPACT / INFO severity
  - Competitive landscape observations
  - Budget assessment and allocation recommendation
  - Confirmed scope for subsequent prompts

## Success Criteria
- [ ] Platform selection validated against objective and audience
- [ ] Budget documented and assessed for adequacy
- [ ] Campaign objective confirmed as aligned with business goals
- [ ] Existing account audited if provided (or noted as new build)
- [ ] Competitive landscape reviewed if competitor URLs provided
- [ ] Operator confirmed scope at gate
- [ ] Intake written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: analyze and report only; no platform changes, no campaign submissions
- Budget observations use ranges and qualifiers, never guarantees
- No ad platform credentials stored in artifacts
