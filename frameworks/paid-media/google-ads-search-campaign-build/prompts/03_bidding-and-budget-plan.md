# 03 — Bidding and Budget Plan

- Step ID: 03
- Name: bidding-and-budget-plan
- Execution mode: REVIEW_ONLY

## Goal
Choose bid strategy and budget per campaign, with geo targeting finalized. Output is defensible — each choice ties back to conversion volume and measurement readiness.

## Inputs expected
- Step 02 output (account-structure-design).
- Step 01 conversion-action inventory and 90d volume.
- Operator CPA/ROAS targets (or explicit "unknown, use learning period").

## Process
1. For each campaign, check conversion volume against the minimum learning threshold for automated bid strategies (operator-provided or default heuristic). Document the check.
2. Choose bid strategy per campaign: Manual CPC for low-volume learning; Maximize Conversions (optionally with tCPA) once volume supports it; tROAS only when revenue is tracked. Justify the choice against the volume check and the measurement readiness from step 01.
3. Set initial budget per campaign. Budgets are floors for learning, not ceilings for spend — size against realistic CPC times expected click volume for the first 2 weeks.
4. Geo: declare target list, exclusion list, and presence-vs-interest setting ("People in or regularly in" vs. "interest"). Default to presence unless operator specifies otherwise.
5. Ad schedule: default 24/7 unless step 01 evidence supports dayparting.
6. Device bid modifiers: start flat (0%) unless step 01 evidence supports a modifier; document the rule.
7. Network settings: Search Network on, Search Partners default off (operator can opt in), Display Network off.
8. Enumerate budget-pacing signals to check weekly post-launch.

## Output artifact
`outputs/google-ads-search-campaign-build/03_bidding-and-budget-plan.md` with sections: Bid Strategy per Campaign, Budget per Campaign, Geo Plan, Ad Schedule, Device/Network Settings, Weekly Pacing Signals. JSON sidecar with campaign-level settings in preview-bundle shape.

## Gates before advancing
- Bidding-strategy gate: strategy per campaign is tied to conversion volume reality and measurement readiness, not convention.
- Geo gate: targets and exclusions explicit, presence/interest setting declared.

## Distilled principles

**Bid strategy follows conversion volume, not ambition.** Automated strategies need signal. Running tCPA with 3 conversions/month produces noise, not optimization.
- Evidence basis: Ed Leake, Planning/Bidding Strategy Foundation + Optimization/Budget Optimisation Game Plan + KnowledgeBase/3_Optimization/bidding_logic.xml. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: accounts that will never reach the threshold (very niche B2B) — Manual CPC may be the permanent state, not a bridge.

**Geo target by presence for local service businesses.** "Interest" geo leaks to researchers outside the service area and inflates clicks that can't convert.
- Evidence basis: Google Ads documented behavior; aligns with Ed Leake local-campaign guidance. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: national ecommerce or content-interest brands where interest-based reach is the goal.

**Budgets are learning floors, not spend ceilings.** Too-tight a budget starves the auction early; the campaign never sees the queries it would convert on.
- Evidence basis: Ed Leake, Planning/Budget & KPI. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: fixed monthly caps from operator — budget becomes a hard ceiling by policy, and the plan documents the tradeoff.
