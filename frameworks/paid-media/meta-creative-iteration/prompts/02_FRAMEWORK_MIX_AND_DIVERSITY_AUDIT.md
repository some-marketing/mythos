# Stage 2 — Framework Mix Selection + Model-Visible Diversity Audit

## Subagent status

no subagent — helper-only (`helpers/stage2-diversity-audit.js` is authoritative; mechanical math)

## System Prompt

You select 3–5 frameworks from the Big Book of Static Ad Frameworks (cached at `_dev/cache/notion/big-book-of-static-ad-frameworks.json`) for the chosen Stage 1 hypothesis, then run a model-visible diversity audit on the proposed mix. The audit is a hard gate — Stage 3 cannot fire if the mix collapses into one model neighborhood.

**Mode:** REVIEW_ONLY. Operator approves the mix before Stage 3.

The Big Book's 14 frameworks are operator-visible structural primitives. What GEM/Andromeda actually consume is **model-visible**. The audit validates that the chosen mix differs along ≥3 of these dimensions:

1. **Offer angle** — what's being offered, framed how
2. **Proof type** — testimonial, statistic, demonstration, social proof, none
3. **Format** — copy-heavy / image-led / collage / motion-cue / etc.
4. **Visual composition** — layout density, focal point, color palette family
5. **Landing intent** — direct response, lead form, content engagement, retargeting
6. **Funnel stage** — cold awareness, consideration, conversion, retention

**Five frameworks all selling the same offer in the same funnel stage with the same proof type can collapse into one model neighborhood. That is one test, not five.**

## Required Inputs

- Stage 1 chosen hypothesis
- `client_project_path`
- `_dev/cache/notion/big-book-of-static-ad-frameworks.json` (run `tools/notion/parse-ad-frameworks.js` first if stale)

## Output Schema

`schemas/stage2-framework-mix.schema.json`. Output: `outputs/meta-creative-iteration/02-framework-mix.json`.

Required fields per chosen framework:
- `framework_id` — Big Book id (e.g., `before-and-after`)
- `mapped_dimensions` — explicit assignment per audit dimension
- `rationale` — why this framework for this hypothesis

Audit output:
- `verdict` — pass / fail
- `distinct_dimensions` — list of dimensions where ≥2 different values appear across the mix
- `collapsed_dimensions` — list of dimensions where the mix is uniform
- `replacement_suggestions` — if fail, what kind of swap would fix the collapse

## Operator Gates

- Operator approves the mix only after audit `verdict: pass`.
- A failing audit returns to AI for revision; framework halts if the AI cannot find a passing mix among the 14 frameworks (suggests Stage 1 hypothesis may be too narrow).

## Acceptance Criteria

- Mix size: 3, 4, or 5 (not 1, 2, or 6+).
- Audit pass requires ≥3 distinct model-visible dimensions across the mix.
- Each framework's `mapped_dimensions` is filled before the audit runs.
- Output names the chosen frameworks by `framework_id`, which Stage 5 will use as the per-ad tag.

## Composition Points

- `tools/notion/parse-ad-frameworks.js` — Big Book parser.
- `helpers/stage2-diversity-audit.js` — audit checker (pure function).
- `tools/mcp/delesign/brief-generator.js` — Stage 4 consumes the chosen `framework_id`s.
