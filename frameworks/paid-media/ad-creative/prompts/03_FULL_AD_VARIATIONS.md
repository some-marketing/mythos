# 03: Full Ad Variations

## Objective
Assemble complete ad units — headlines paired with descriptions and CTAs — formatted for each target platform's upload requirements. Each ad unit must be a coherent, ready-to-upload combination.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/ad-creative/intake-and-brand-context.md` from Prompt 01
- `outputs/ad-creative/confirmed-terms-ledger.json` from Prompt 01
- `outputs/ad-creative/headline-variations.md` from Prompt 02
- Platform character limits from intake
- Brand voice constraints from intake

## Steps

0. [GATE] **Confirmed-terms binding preflight — run BEFORE authoring any copy (see `guardrails.md` → Amendment B).**
   - Load `outputs/ad-creative/confirmed-terms-ledger.json`.
   - **Confirmed-label integrity:** every row `status: confirmed` must have a real `provenance` citation. Any confirmed row with empty provenance is a hard-fail — either cite the client source or downgrade to `pending`. Do not author copy against an uncited "confirmed" fact.
   - **Pending-fact handling:** `pending` rows may be surfaced only as clearly-optional, footnoted, omit-at-build elements — never as load-bearing claims. Only `confirmed` rows are load-bearing.
   - This is the pre-authoring half of the check; the omission diff (step 7) runs after copy is assembled.

1. [AUTO] **Generate descriptions per platform:**

   **Google RSA descriptions** (90 chars, 4 total):
   - 1 benefit + proof point description
   - 1 feature + outcome description
   - 1 social proof + CTA description
   - 1 urgency/offer + CTA description (if applicable, otherwise benefit + objection handler)

   Each description must:
   - Complement headlines, not repeat them
   - Include character count
   - Handle a common objection OR reinforce a CTA

   **Meta primary text** (125 chars visible, up to 2,200):
   - Front-load the hook in the first 125 characters
   - Use line breaks for readability in longer versions
   - Generate 3-4 primary text variations at different lengths:
     - Short (under 125 chars — no truncation)
     - Medium (200-400 chars — one expansion click)
     - Long (600+ chars — storytelling format, if appropriate)

   **LinkedIn intro text** (150 chars recommended, 600 max):
   - Professional tone — data points and peer-relevant language
   - Avoid consumer-style hype
   - Generate 3-4 intro text variations

2. [AUTO] **Generate CTA elements per platform:**

   **Google RSA**: CTA-focused headlines (already in headline set from Prompt 02) + CTA descriptions
   **Meta**: Headline (below image, 40 chars) + description (below headline, 30 chars) + CTA button (platform options: Learn More, Sign Up, Shop Now, etc.)
   **LinkedIn**: Headline (below image, 70 chars) + CTA button

3. [AUTO] **Assemble complete ad units:**

   **Google RSA package:**
   ```
   Headlines (12-15):
   1. "[headline]" (XX chars)
   ...
   Descriptions (4):
   1. "[description]" (XX chars)
   ...
   Display paths: /[path1]/[path2]
   ```

   **Meta ad units** (assemble 4-6 complete variations):
   ```
   Variation A — [Angle name]:
   Primary text: "[text]" (XX chars)
   Headline: "[headline]" (XX chars)
   Description: "[description]" (XX chars)
   CTA button: [button label]
   ```

   **LinkedIn ad units** (assemble 3-4 complete variations):
   ```
   Variation A — [Angle name]:
   Intro text: "[text]" (XX chars)
   Headline: "[headline]" (XX chars)
   CTA button: [button label]
   ```

4. [AUTO] **Combination coherence check:**
   - For RSA: verify that any random combination of 3 headlines + 2 descriptions reads coherently
   - For Meta/LinkedIn: verify that primary text + headline + description + CTA form a consistent message per variation
   - Flag any combination that produces a contradictory or redundant message

5. [AUTO] **Platform spec validation:**
   - Every element checked against character limits
   - Over-limit elements flagged and trimmed
   - Display paths validated (Google: 15 chars each)
   - Meta description checked (may not show in all placements — must not be critical)

6. [AUTO] **Brand voice final check:**
   - All new copy (descriptions, primary text, CTAs) validated against brand voice
   - Consistent tone across all variations within a platform
   - No forbidden words or unapproved claims

7. [AUTO] **Confirmed-terms omission diff — run AFTER copy is assembled (see `guardrails.md` → Amendment B).**
   - Diff the produced copy against the ledger. Every `confirmed` + `must-appear` term must appear in the load-bearing copy; any that is absent was silently DROPPED and must be restored before the draft is accepted.
   - Run the framework helper as evidence (verdict is advisory evidence, not a hard gate):
     ```sh
     node helpers/confirmed-terms-preflight.js \
       --ledger outputs/ad-creative/confirmed-terms-ledger.json \
       --copy <load-bearing copy body> [--footnotes <optional/footnote zone>] --json
     ```
   - Resolve every hard-fail: `confirmed-term-omitted` → restore the term; `pending-fact-load-bearing` → move it to an omit-at-build footnote or obtain provenance; `confirmed-without-provenance` → cite the source or downgrade to `pending`. Attach the verdict to the operator gate.

8. [GATE] Present complete ad units to operator for review:
   - Organized by platform
   - Each variation labeled by angle
   - Character counts visible on every element
   - Ready for upload or CSV export

9. [AUTO] Write full ad variations to `outputs/ad-creative/full-ad-variations.md`.

## Outputs
- `outputs/ad-creative/full-ad-variations.md` containing:
  - Google RSA package (headlines, descriptions, display paths) if applicable
  - Meta ad unit variations (primary text + headline + description + CTA) if applicable
  - LinkedIn ad unit variations (intro text + headline + CTA) if applicable
  - Character counts on every element
  - Combination coherence notes
  - CSV-ready format section for bulk upload (if 10+ variations)

## Success Criteria
- [ ] Complete ad units assembled for every target platform
- [ ] Descriptions complement headlines — no repetition within a unit
- [ ] All elements include character counts and respect platform limits
- [ ] RSA combinations checked for coherence across random pairings
- [ ] Meta/LinkedIn variations form consistent messages per unit
- [ ] Brand voice consistent across all variations
- [ ] Confirmed-terms preflight passed: ledger integrity holds (no uncited "confirmed" fact), omission diff clean (no `must-appear` confirmed term dropped), pending facts only in omit-at-build footnotes — verdict attached as evidence
- [ ] No performance guarantees in any copy
- [ ] Operator has reviewed complete ad units before proceeding

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: assemble and review creative from existing outputs; no new data collection
- Descriptions must add value beyond headlines — proof points, objection handling, or CTAs
- No new angles introduced here — use only angles established in Prompt 02
