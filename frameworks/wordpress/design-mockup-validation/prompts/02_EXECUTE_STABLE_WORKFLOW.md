# 02 Execute Stable Workflow

## Objective
Run the 7-step cross-AI mockup generation workflow using the execution plan from Prompt 01.

## Mode
RUN_ONLY (steps 1-4, 7) | PATCH_ALLOWED (step 6 — post-review fixes)

## Inputs (from Prompt 01)
- `outputs/execution-plan.json` — element list, evidence paths, spec references, iteration params

## Steps
1. **Evidence scrape** — For each element in `execution-plan.json`, use Playwright to capture element HTML, computed styles, screenshots, and structured data from the target site. Write to `outputs/elements/<element-id>/evidence/`.
2. **Design language extraction** — Extract design tokens and personality profile from scraped HTML using `design-language-extract.js`. Write `outputs/design-language.json`.
3. **Prompt assembly** — Assemble Gemini prompts from evidence bundle + spec reference + constraint reference using `prompt-builder.js`. Write `outputs/elements/<element-id>/attempt-1/prompt.md` per element.
4. **Gemini mockup generation** — For each element, run the 3-attempt iteration cycle (truth/compliance -> variation/lift -> convergence) via Gemini API. Write `outputs/elements/<element-id>/attempt-{1,2,3}/response.html`.
5. **Codex review gate** — Submit all FINAL files to a scoped Codex review against spec and constraints. Write `outputs/codex-review-gate.md`.
6. **Post-review fix pass** — Apply fixes for all Codex findings (PATCH_ALLOWED mode). Write corrected `outputs/elements/<element-id>/FINAL_<name>.html`.
7. **Operator review packet** — Assemble per-element comparison, reasoning attribution, and review verdicts. Write `outputs/execution-summary.json`.
8. Record any deviations from the known stable path in `outputs/execution-summary.json` under the `deviations` field.

## Outputs (consumed by Prompt 03)
- `outputs/execution-summary.json` — validates against `schemas/output/execution-summary.schema.json`
- `outputs/elements/<element-id>/FINAL_*.html` — one per element
- `outputs/codex-review-gate.md` — raw review gate output

## Success Criteria
- All elements complete the full iteration cycle
- `execution-summary.json` validates against its schema
- Each FINAL HTML file exists and ends with `</html>`
- Deviations documented, not silently swallowed

## Guardrails
- Follow guardrails.md RUN_ONLY constraints for steps 1-4, 7
- Follow guardrails.md PATCH_ALLOWED constraints for step 6
- Pause if hidden operator judgment is still required
