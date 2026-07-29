# 03 Review And Compare

## Objective
Compare the produced outputs from Prompt 02 against the success criteria and source evidence, producing a structured review report.

## Mode
REVIEW_ONLY

## Inputs (from Prompt 02)
- `outputs/execution-summary.json` — element results, attempt counts, review verdicts, evidence linkage
- `outputs/elements/<element-id>/FINAL_*.html` — final validated HTML per element
- `outputs/codex-review-gate.md` — raw review gate findings

## Steps
1. Read `outputs/execution-summary.json` and validate against `schemas/output/execution-summary.schema.json`.
2. For each element, verify the FINAL HTML file exists and ends with `</html>`.
3. Cross-check each element's `review_verdict` against the Codex review gate findings.
4. Evaluate each success criterion from the capture's `success_criteria.json` against the actual outputs.
5. Identify any deviations, missing steps, or new dependencies not covered by the workflow.
6. **Visual validation** — if a live staging URL and CSS selectors are available in the project context:
   a. Run `tools/ai-bridge/design-validate.js` with `--mockup` pointing to the FINAL HTML, `--live-url` to the staging page, and `--sections` targeting the relevant content selectors.
   b. Use `--mockup-sections` and `--live-sections` when mockup and live use different selectors (common for standalone HTML vs Breakdance page builder).
   c. Use focused element screenshots (`.locator().screenshot()`) — full-page screenshots lose section-level detail.
   d. Include `--mobile-viewport 393x852` for responsive validation when the mockup has `@media` rules.
   e. Record visual findings in `reports/visual-validation.json`. If any finding is CRITICAL, the review verdict must be FAIL.
   f. If no live URL is available, note "visual validation deferred — no staging URL" and proceed with file-only review.
7. Write `reports/review-report.json` validating against `schemas/output/review-report.schema.json`.

## Outputs
- `reports/review-report.json` — validates against `schemas/output/review-report.schema.json`
- `reports/visual-validation.json` — Gemini visual comparison results (when live URL available)

## Success Criteria
- `review-report.json` validates against its schema
- Every element has an explicit pass/fail/partial verdict with evidence
- Success criteria check has one entry per criterion from the source capture
- Recommendations are actionable and scoped
- If visual validation ran, no CRITICAL findings remain unaddressed
- If visual validation was deferred, the reason is documented in review-report.json

## Guardrails
- Follow guardrails.md REVIEW_ONLY constraints
- Do not modify any output files — read-only assessment
- Pause if hidden operator judgment is still required
