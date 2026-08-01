# 04: Creative Testing Plan

## Objective
Produce a structured testing matrix, hypothesis per variation, measurement plan, and iteration framework. This is the plan that determines what to test, in what order, and how to decide winners.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/ad-creative/intake-and-brand-context.md` from Prompt 01
- `outputs/ad-creative/headline-variations.md` from Prompt 02
- `outputs/ad-creative/full-ad-variations.md` from Prompt 03
- Campaign objective from intake
- Existing performance data from intake (if provided)

## Steps

1. [AUTO] **Define testing priorities:**
   Determine what to test first based on campaign objective and available data:
   - If starting from scratch: test angles first (which motivation resonates)
   - If iterating from data: test variations within winning angles
   - Rank testing priorities by expected impact:
     1. Angle (which message theme)
     2. Headline (which specific phrasing)
     3. Description/primary text (which supporting message)
     4. CTA (which action prompt)
     5. Format/length (short vs. long primary text)

2. [AUTO] **Build testing matrix:**

   | Test | Variable | Control | Challenger | Hypothesis | Success Metric | Min. Impressions |
   |------|----------|---------|------------|------------|---------------|-----------------|
   | 1 | Angle | [current/default] | [new angle] | [specific hypothesis] | [CTR/CVR/ROAS] | 1,000+ per variant |
   | 2 | ... | ... | ... | ... | ... | ... |

   Rules for the matrix:
   - One variable per test (do not test angle + CTA simultaneously)
   - Each test must have a clear control and challenger
   - Tests ordered by priority (highest-impact variable first)
   - Platform-specific tests separated (Google RSA testing differs from Meta A/B)

3. [AUTO] **Write hypothesis per test:**
   Each hypothesis must follow this format:
   ```
   If we [change], then [metric] will [direction] because [reasoning based on intake findings].
   ```
   Example:
   ```
   If we replace the feature-focused headline with a pain-point headline,
   then CTR will increase because intake data shows the audience is
   problem-aware and responds to language about their current frustrations.
   ```

   - Hypotheses must be falsifiable
   - Reasoning must cite specific intake findings (audience stage, existing performance patterns, competitor gaps)
   - No guaranteed outcomes — use "we expect" or "may increase"

4. [AUTO] **Define measurement plan per platform:**

   **Google RSA:**
   - Let Google's machine learning optimize headline/description combinations
   - Review asset-level performance after 2-4 weeks (minimum 1,000 impressions per asset)
   - Focus on headline asset performance ratings (Low, Good, Best)
   - Do not pin headlines unless testing a specific position hypothesis

   **Meta:**
   - Use A/B test feature (not just ad set budget optimization)
   - Run each variation for minimum 3-7 days or until 1,000+ impressions
   - Primary metric tied to campaign objective (CTR for awareness, CPA for conversion)
   - Monitor frequency — pause at 3+ to avoid fatigue

   **LinkedIn:**
   - Run each variation for minimum 7 days (longer sales cycle)
   - Monitor CTR and engagement rate
   - Check audience quality via lead form completion rate if applicable

5. [AUTO] **Build iteration framework:**

   **After each test cycle:**
   ```
   ## Iteration Log — Cycle [N]
   - Date range: [start] to [end]
   - Test: [what was tested]
   - Result: [metric values for control vs. challenger]
   - Winner: [which variation, or inconclusive]
   - Pattern observed: [what this tells us about the audience]
   - Next action:
     - [ ] Scale winner
     - [ ] Retire loser
     - [ ] Generate new variations extending winning pattern
     - [ ] Test next variable in priority order
   ```

   **Decision rules:**
   - Winner declared when one variation outperforms by 10%+ with statistical significance (or 1,000+ impressions per variant minimum)
   - Inconclusive after 2,000+ impressions per variant — move to next test, revisit later
   - Retire a variation only after 1,000+ impressions with consistent underperformance
   - Never retire all variations of an angle based on one test — test phrasing variations first

6. [AUTO] **Creative fatigue monitoring plan:**
   - Define fatigue indicators: CTR declining 20%+ week-over-week, frequency above 3
   - Schedule creative refresh cadence (recommend every 4-6 weeks for Meta, 6-8 weeks for Google)
   - Plan for refresh: new variations within proven angles, plus 1-2 new exploratory angles per cycle

7. [GATE] Present testing plan to operator for review:
   - Testing matrix with priorities
   - Hypotheses for each test
   - Measurement timeline
   - Decision rules
   - Refresh cadence

8. [AUTO] Write testing plan to `outputs/ad-creative/creative-testing-plan.md`.

## Outputs
- `outputs/ad-creative/creative-testing-plan.md` containing:
  - Testing priority order with rationale
  - Testing matrix (variable, control, challenger, hypothesis, metric, minimum impressions)
  - Hypothesis per test with falsifiable prediction and reasoning
  - Measurement plan per platform with timeline
  - Iteration log template
  - Decision rules for declaring winners, retiring losers, and handling inconclusive results
  - Creative fatigue monitoring plan with refresh cadence
  - Recommended first test to launch

## Success Criteria
- [ ] Testing matrix covers at least 3 tests in priority order
- [ ] Every test changes exactly one variable
- [ ] Every hypothesis is falsifiable and cites intake findings
- [ ] Measurement plan includes minimum impression thresholds
- [ ] Decision rules are specific (percentages, impression counts) not vague
- [ ] Iteration log template included for ongoing use
- [ ] Creative fatigue plan included with refresh cadence
- [ ] No guaranteed outcomes in any hypothesis or recommendation
- [ ] Operator has reviewed testing plan before launch

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: synthesize and plan from existing outputs only; no new creative generation
- All predictions use hypothesis framing — "we expect" or "may increase," never "will increase"
- Minimum impression thresholds must be stated for every test — no early winner declarations
- Testing plan must not recommend testing more than one variable per cycle
