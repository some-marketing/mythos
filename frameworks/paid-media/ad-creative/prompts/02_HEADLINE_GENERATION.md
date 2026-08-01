# 02: Headline Generation

## Objective
Generate headline variations across multiple angles, validated against platform-specific character limits. Each angle taps into a different audience motivation to maximize creative diversity.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/ad-creative/intake-and-brand-context.md` from Prompt 01
- Recommended angles from intake
- Platform character limits from intake
- Brand voice constraints from intake

## Steps

1. [AUTO] **Define angles** (minimum 4, target 5-6):
   Select from these categories based on intake findings. Each angle must be distinct — different motivation, not just different wording.

   | Category | Pattern | Example |
   |----------|---------|---------|
   | Benefit/Outcome | "Achieve Y in Z days" | "Ship Code 3x Faster" |
   | Feature | "Built-in X for Y" | "Built-In CI/CD Pipeline" |
   | Social proof | "Join N+ who..." | "Join 10,000+ Teams" |
   | Urgency | "Limited: get X free" | "Free Trial Ends Friday" |
   | Question | "Still doing X manually?" | "Still Building Reports?" |
   | Contrast/Comparison | "Unlike X, we do Y" | "Reports in 5 Min, Not 5 Hr" |
   | Pain point | "Stop wasting time on X" | "Stop Manual Data Entry" |
   | Identity | "Built for [role]" | "Built for Growth Teams" |
   | Curiosity | "The X that top companies use" | "The Reporting Secret of Inc 500" |

2. [AUTO] **Generate headline variations per angle:**
   For each angle, produce 4-6 headline variations. Vary across:
   - **Word choice** — synonyms, active vs. passive
   - **Specificity** — numbers vs. general claims ("75%" vs. "dramatically")
   - **Tone** — direct statement vs. question vs. command
   - **Structure** — short punch vs. full benefit statement

   Format each headline with character count:
   ```
   "Stop Building Reports by Hand" (29)
   ```

3. [AUTO] **Platform-specific validation:**
   - Check every headline against the target platform's character limit
   - Flag any headline over the limit with `<- OVER LIMIT`
   - Provide a trimmed alternative immediately below each flagged headline
   - For multi-platform campaigns, generate platform-specific sets:
     - Google RSA: 30-char headlines (target 12-15 total)
     - Meta: 40-char headlines
     - LinkedIn: 70-char headlines

4. [AUTO] **RSA combination check** (Google Ads only):
   - Verify each headline makes sense independently
   - Verify no two headlines say the same thing (would waste a slot)
   - Confirm the set includes the recommended mix:
     - 3-4 keyword-focused
     - 3-4 benefit-focused
     - 2-3 social proof
     - 2-3 CTA-focused
     - 1-2 differentiators
     - 1 brand name headline

5. [AUTO] **Brand voice check:**
   - Validate every headline against brand voice constraints from intake
   - Flag any headline that uses forbidden words or violates tone directives
   - Replace flagged headlines with compliant alternatives

6. [GATE] Present headline set to operator for review:
   - Organized by angle with character counts
   - Over-limit headlines flagged and trimmed
   - Brand voice violations resolved
   - Recommended headlines to pin (RSA) or prioritize

7. [AUTO] Write headline variations to `outputs/ad-creative/headline-variations.md`.

## Outputs
- `outputs/ad-creative/headline-variations.md` containing:
  - Angles defined with rationale
  - Headline variations per angle with character counts
  - Platform-specific sets (if multi-platform)
  - RSA combination analysis (if Google Ads)
  - Brand voice compliance notes
  - Operator-approved headline set

## Success Criteria
- [ ] Minimum 4 distinct angles defined
- [ ] Minimum 4 headline variations per angle
- [ ] Every headline includes character count
- [ ] All headlines within platform character limits (or trimmed alternative provided)
- [ ] RSA headlines validated for independent readability (if Google Ads)
- [ ] No brand voice violations in final set
- [ ] No guaranteed performance claims
- [ ] Operator has reviewed headline set before proceeding

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: review and refine generated creative; no new data collection
- Performance language: "this headline tests the [benefit] angle" not "this headline will convert"
- All headlines must include character counts — no exceptions
- Confirmed-terms binding (`guardrails.md` → Amendment B): any headline that surfaces an offer term — promo code, price, freebie, guarantee, date — must trace to a `confirmed` row in the confirmed-terms ledger. Never put a `pending` or uncited fact into a headline as a settled claim.
