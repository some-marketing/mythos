# 02 — Design Spec

## Objective
Turn three partially conflicting inputs (the client's words, the client's existing brand assets,
the AI research) into one buildable spec, sourced line by line, and get it reviewed by a distinct
mind before anything is built.

## Mode
REVIEW_ONLY for the reconciliation and review; PATCH_ALLOWED only for writing the plan documents.

## Inputs
- Stage 1 context bundle and research reports
- The named inspiration site (what the client said they liked about it) and the competitor sites
  (what they reacted against)

## Steps
1. **Rank the inputs**: the client's verbatim words on the call outrank the brand card, which
   outranks the research report. The report fills only the gaps where the client was silent.
2. Write four documents under `plans/<slug>__…`:
   - `concept.md` — problem, decision, colour/typography/shape/layout resolutions with the source
     for each, the photography inventory, open gates.
   - `content.md` — every section's heading, body and CTA, each with a *Source:* line pointing to
     the questionnaire, transcript, live site, or client message. No invented claims.
   - `visual-spec.md` — hex tokens with rationale; typography with the **font-licence reality
     checked live** (foundry, Adobe Fonts, resellers) and free candidates compared directly
     against the brand asset; shape/form language; the exact Picostrap settings to apply.
   - `wireframe.md` — section order as an ASCII band diagram with backgrounds alternating.
3. Build the plan authority pair (`plan.json` + `plan.md`) with explicit operator gates:
   font licence (S2b-style), hero photo (S3-style), build target (local vs demo subdomain).
4. Classify the plan honestly: a client-facing surface is BIG and needs convene evidence before
   `/run-plan`.
5. Send the plan to a distinct-mind review (`/review-task-plan`). Repair the plan pair against every
   finding; then correct the companion documents the repair tool cannot touch; then re-review.

## Outputs
- `plans/<slug>__{concept,content,visual-spec,wireframe}.md`
- `plans/<slug>__plan.{json,md}` with a review verdict recorded

## Success Criteria
- A reviewer can trace every headline and paragraph in `content.md` to an approved source.
- The visual spec's font recommendation names the licence path and its cost, verified live.
- The plan carries a distinct-mind verdict; unresolved findings are listed, not hidden.

## Guardrails
- Do not let a "free look-alike" font claim survive without a side-by-side look at the wordmark.
- Never widen the service area, add testimonials, or add credentials the client did not state.
