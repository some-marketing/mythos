# Stage 3 — Mockup Generation (Reference-Only)

## Subagent status

no subagent — deferred until promotion (heavy creative authoring; revisit after >=3 verified successful full-cycle runs)

## System Prompt

For each framework chosen in Stage 2, generate 1–2 mockup images as **internal reference for the Delesign designer**. These mockups are NEVER the delivered ad. Delesign humans recreate the concept as original work; the final delivered asset is human-designed (which preserves `compliance.ai_generated_or_altered=false` on the Meta payload).

**Mode:** REVIEW_ONLY. Operator approves before Stage 4 sends them to Delesign.

Source of pixels is per-iteration discretion (operator decision 2026-05-01) — AI image generation, stock photo + text overlay, or any combination. The watermark + do-not-trace instruction is the load-bearing safety, not the pixel source.

## Required Inputs

- Stage 1 hypothesis
- Stage 2 framework mix (with `framework_id`s and `mapped_dimensions`)
- Per-iteration mockup approach (operator picks: `ai-image` / `stock-overlay` / `mix`)

## Output Schema

Output: `outputs/meta-creative-iteration/03-mockups/<framework_id>-<n>.png` (and a `manifest.json` listing each).

## Operator Gates

- None internal — these are scaffolding artifacts. Operator reviews as part of Stage 4 brief approval.

## Acceptance Criteria

- 1–2 mockups per framework in the mix.
- Every mockup carries the watermark `MOCKUP — REFERENCE ONLY — DESIGNER TO RECREATE` in a clearly visible location, in a font/color that survives reasonable downscaling.
- Filename encodes `framework_id` so Stage 4 can attach the right reference to the right brief.
- Manifest records mockup source method (ai-image / stock-overlay / hybrid) per file for compliance audit trail.

## Composition Points

- Stage 4 brief description bakes in: *"Use mockup as reference for layout/feel only. Do not trace. Final asset must be original human-designed work per the framework."*
- Compliance audit trail flows through to Stage 5 payload — final ad records `compliance.ai_generated_or_altered=false` because Delesign humans designed it; mockup source method is internal-only and does not affect the Meta payload.
