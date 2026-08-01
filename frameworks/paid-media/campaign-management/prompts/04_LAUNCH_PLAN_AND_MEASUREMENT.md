# 04: Launch Plan and Measurement

## Objective
Produce a launch checklist, tracking setup requirements, measurement framework with KPIs and reporting cadence, and an optimization playbook for the first 30/60/90 days. This is the operational handoff to the operator.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/campaign-management/intake-and-audit.md` from Prompt 01
- `outputs/campaign-management/campaign-structure.md` from Prompt 02
- `outputs/campaign-management/ad-copy-and-creative-brief.md` from Prompt 03

## Steps

1. [AUTO] **Pre-launch checklist** (platform-specific):

   **Universal requirements:**
   - [ ] Conversion tracking tested with a real conversion event
   - [ ] Landing page loads in under 3 seconds
   - [ ] Landing page is mobile-friendly
   - [ ] UTM parameters configured and tested
   - [ ] Budget set correctly (daily vs. lifetime)
   - [ ] Start/end dates confirmed
   - [ ] Targeting matches intended audience
   - [ ] Ad creative approved by operator
   - [ ] Team notified of launch date
   - [ ] Reporting dashboard prepared

   **Google Ads specific:**
   - [ ] Google tag installed on all pages
   - [ ] Conversion actions created and values assigned
   - [ ] Enhanced conversions enabled
   - [ ] GA4 linked and auto-tagging enabled
   - [ ] Remarketing tag verified
   - [ ] Negative keyword lists applied
   - [ ] Ad extensions configured
   - [ ] Brand campaign running (brand term protection)

   **Meta specific:**
   - [ ] Meta Pixel installed and firing
   - [ ] Standard events configured (PageView, ViewContent, Lead, Purchase)
   - [ ] Conversions API (CAPI) set up for server-side tracking
   - [ ] Domain verified in Business Manager
   - [ ] Aggregated Event Measurement configured with top 8 events prioritized
   - [ ] Special Ad Categories declared if applicable
   - [ ] Creative assets in correct sizes per placement

   **LinkedIn specific:**
   - [ ] Insight Tag installed and verified
   - [ ] Conversion tracking configured (URL-based or event-specific)
   - [ ] Lead gen form templates created and CRM integration tested (if using)
   - [ ] Audience size validated (50K+ recommended)
   - [ ] Budget realistic for LinkedIn CPCs ($8-15+ typical)

   Note: include only checklist sections for platforms in scope.

2. [AUTO] **Tracking setup requirements:**
   - UTM parameter convention:
     - `utm_source`: platform name (google, meta, linkedin, etc.)
     - `utm_medium`: paid, cpc, paid-social
     - `utm_campaign`: campaign name matching platform naming convention
     - `utm_content`: ad variation identifier
     - `utm_term`: keyword (search) or audience (social)
   - Conversion pixel requirements per platform
   - Server-side tracking recommendations (Meta CAPI, Google Enhanced Conversions)
   - GA4 integration requirements for cross-platform attribution
   - Attribution considerations:
     - Platform attribution is typically inflated
     - Compare platform data to GA4
     - Look at blended CAC, not just platform CPA
     - Note attribution window differences across platforms

3. [AUTO] **Measurement framework:**

   **KPIs by objective:**
   | Objective | Primary KPIs | Secondary KPIs |
   |-----------|-------------|----------------|
   | Awareness | CPM, Reach, Video view rate | Brand lift, Frequency |
   | Traffic | CPC, CTR, Sessions | Bounce rate, Time on site |
   | Leads | CPA (cost per lead), Lead volume, Conversion rate | Lead quality score, SQL rate |
   | Sales | ROAS, CPA, Revenue | AOV, LTV, Repeat purchase rate |

   **Reporting cadence:**
   - Daily (first 2 weeks): spend pacing, delivery status, any anomalies
   - Weekly: CPA/ROAS vs. targets, top/bottom performers, audience breakdown, frequency check, landing page conversion rate
   - Monthly: channel-level performance, budget reallocation, creative fatigue assessment, audience expansion/contraction
   - Quarterly: strategic review, platform mix evaluation, year-over-year comparison

   **Benchmarks:**
   - Cite industry benchmarks for the client's vertical (if `industry` was provided)
   - Note that benchmarks are directional, not targets
   - Document baseline metrics from existing account audit (if available)

4. [AUTO] **Optimization playbook — first 90 days:**

   **Days 1-30: Learning phase**
   - Monitor daily: delivery, spend pacing, any disapprovals
   - Do not make major changes during algorithm learning period (typically 7-14 days per platform)
   - Identify early signals: which audiences, creatives, and keywords show promise
   - If CPA is too high: check landing page first (post-click problem?), then tighten targeting, then test new creative
   - If CTR is low: creative is not resonating -> test new hooks/angles; audience mismatch -> refine targeting
   - If CPM is high: audience too narrow -> expand; high competition -> try different placements
   - Week 2-3: pause clearly underperforming ads (bottom 20% by CPA or CTR)
   - Week 3-4: first creative refresh cycle

   **Days 31-60: Optimization phase**
   - Consolidate budget into winning campaign/ad set combinations
   - Scale winning audiences: increase budgets 20-30% at a time, wait 3-5 days between increases
   - Expand keyword coverage (Google): add phrase/broad match for proven themes
   - Test lookalike expansion (Meta/LinkedIn): move from 1% to 1-3%
   - Refresh creative to prevent fatigue
   - Evaluate bid strategy progression: if 50+ conversions accumulated, consider switching to automated bidding
   - Review landing page conversion rate — if below benchmark, flag for CRO

   **Days 61-90: Scaling phase**
   - Evaluate platform mix: shift budget toward highest-performing platform(s)
   - Introduce new campaign types (retargeting tiers, new objectives)
   - Build on proven audiences with new creative angles
   - Set up automated rules (where platform supports) for budget pacing and bid adjustments
   - Comprehensive performance review: compare actuals to initial projections and benchmarks
   - Recommend next-quarter strategy adjustments

5. [GATE] Present launch plan and measurement framework to operator for final review:
   - Confirm tracking implementation responsibilities
   - Confirm reporting cadence and dashboard access
   - Confirm optimization decision rights (who approves budget shifts, pauses, etc.)
   - Confirm launch date

6. [AUTO] Write launch plan and measurement framework to `outputs/campaign-management/launch-plan-and-measurement.md`.

## Outputs
- `outputs/campaign-management/launch-plan-and-measurement.md` containing:
  - Pre-launch checklist (platform-specific)
  - Tracking setup requirements (UTMs, pixels, server-side tracking, GA4 integration)
  - Measurement framework (KPIs by objective, reporting cadence, benchmarks)
  - Optimization playbook: 30/60/90-day plan with specific actions per phase
  - Attribution considerations and cross-platform measurement notes

## Success Criteria
- [ ] Pre-launch checklist covers all platforms in scope
- [ ] UTM convention documented and consistent with campaign naming
- [ ] Conversion tracking requirements specified per platform
- [ ] KPIs defined and matched to the confirmed campaign objective
- [ ] Reporting cadence defined (daily, weekly, monthly, quarterly)
- [ ] 30/60/90-day optimization playbook includes specific decision criteria (not vague "optimize")
- [ ] Benchmarks cited for performance expectations (industry or historical, never invented)
- [ ] Attribution limitations acknowledged
- [ ] Operator confirmed launch readiness at gate
- [ ] No new campaign structure introduced (this prompt operationalizes, not redesigns)

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: produce launch plan for operator review; no platform submissions or tracking code installation
- Performance projections cite their source (historical data, industry benchmark, platform average)
- Never guarantee specific outcomes: "based on [benchmark source], similar campaigns observe..." not "you will achieve..."
- Tracking implementation is the operator's responsibility — document requirements, do not execute
- Optimization recommendations are decision frameworks, not automated rules to apply blindly
