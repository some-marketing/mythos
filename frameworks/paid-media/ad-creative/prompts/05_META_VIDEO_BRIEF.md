# 05: Meta Video Brief

## Objective
Author a production-ready video creative brief for Meta (Facebook + Instagram) when the requested creative format is video. This is the OPTIONAL chain step: run it ONLY when `platform` includes Meta AND the creative format is video (Reels/Stories/Feed/in-stream). It produces the concept set, hook-first structure, placement-aware aspect-ratio intent, variation-set mandate, and predictive benchmarks that a video editor or design vendor can execute against. It does not restate perishable specs — it cites the dated canonical reference.

## When to run
- Run when: `platform` ∈ {Meta} AND creative format = video.
- Skip when: platform is non-Meta only, OR the creative format is static/image/copy-only (Prompts 02–04 already cover those).
- This step is additive to the chain — it does not replace headline/variation/testing prompts; it supplies the video brief that pairs with them.

## Canonical reference (cite, do NOT inline)
- `frameworks/_shared/reference/meta-video-creative-2025-2026.md` — all perishable specs (resolutions, durations, safe-zone percentages, CPM/CPA deltas, hook/hold/CTR/play-rate thresholds, algorithm names, named practitioners) live there, dated.
- Cite specs by reference; never copy a number into this brief or its outputs as if it were durable. If the reference's `valid_through` has passed, treat every number as advisory and flag for refresh before asserting it.
- Brief-submit/asset gates live in the Delesign tooling (`tools/mcp/delesign/CHECKLIST.md`, `brief-checklist.js`, `templates/video-brief.template.md`) — this prompt supplies the creative intent; that tooling supplies the submit gate.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/ad-creative/intake-and-brand-context.md` from Prompt 01 (audience temperature, objective, brand voice, mandatory branding/disclaimer elements)
- `platform` and creative format confirmation (Meta + video)
- `campaign_objective` from intake (drives length intent)
- `target_audience` from intake (drives structure-by-temperature: cold vs. warm/retargeting)
- `visual_guidelines` / OEM brand standards from intake (Ford/Mazda early-branding or financial-disclaimer mandates, if any)
- Existing video performance data from intake (if provided)

## Steps

1. [AUTO] **Confirm trigger.** Verify platform includes Meta and creative format is video. If not, note that this prompt does not apply and stop.

2. [AUTO] **Set concept count.** Brief multiple genuinely-distinct concepts per campaign (concept diversity is the testing lever, not narrow-audience cuts). Use the per-campaign concept range from the canonical reference; cite it rather than restating the number.

3. [AUTO] **Hook-first opening (per concept).**
   - Open on motion / a human face / the strongest line within the first-seconds window defined in the reference. No opening logo card (see OEM exception in step 7).
   - Specify a 4–6 word first-frame text overlay for each concept (the muted-scroll hook).
   - First scene change inside the reference's early-cut window.
   - Design for sound-off: open captions burned in on every cut, native caption style.

4. [AUTO] **Structure by audience temperature.**
   - Cold audiences → problem-first: Problem → reaction → mechanism (vehicle/offer as fix) → social proof → CTA with urgency.
   - Warm / retargeting → offer-first: lead with the offer/CTA, lighter problem setup.
   - State which structure each concept uses and why, citing the audience stage from intake.

5. [AUTO] **Length by objective.** Set a target duration per concept derived from `campaign_objective` and placement, citing the per-placement duration guidance in the reference (do not inline the seconds). Note the working ceiling per placement.

6. [AUTO] **Aspect-ratio intent per placement.** Map each placement to its target aspect ratio + resolution PER THE CANONICAL REFERENCE (do not inline the values here): vertical for Reels/Stories as the primary deliverable, the Feed ratio for Feed, in-stream landscape only if that placement is in plan. Apply the reference's Feed-ratio preference (it flags the square ratio as deprecated) and cite it.
   - Respect platform-UI safe zones — keep text/logos clear of the reserved top/bottom chrome; cite the reference's safe-zone percentages rather than restating them.
   - Flag that auto-crop can break brand standards; require a native cut per primary AR, not a single master auto-cropped.

7. [AUTO] **OEM / regulated branding exception.**
   - For OEM clients (Ford / Mazda) or regulated offers, brand standards or financial disclaimers may MANDATE early/explicit branding or a disclaimer frame — this OVERRIDES the "no opening logo / hook-before-branding" rule.
   - When intake declares such a mandate, encode the required branding/disclaimer placement in the brief and note that it supersedes the default hook-first opening. Flag per client.
   - See framework guardrails ("Meta video creative") and the canonical reference's OEM/regulated exception.

8. [AUTO] **Variation-set mandate.** Each concept ships as a variation set, not a single cut: isolate one variable per variation (hook, first-frame overlay, structure, CTA, length), iterate winners vs. fresh per the reference's ratio. Custom cover/thumbnail over the auto-frame; supply multiple cover options. If all concepts fail at once, the offer is the problem, not the creative — say so.

9. [AUTO] **Predictive benchmarks.** State the success thresholds (hook/thumbstop, hold rate, outbound CTR, play rate) and the conversions-per-variant minimum before declaring a winner by CITING the reference's benchmark block. Note which of these are not default Ads-Manager metrics and must be built as custom metrics. Use hypothesis framing — "targets," not guarantees.

10. [GATE] Present the video brief to the operator for review:
    - Concept set with per-concept hook, first-frame overlay, structure, length, AR plan
    - OEM/disclaimer exceptions flagged where they apply
    - Variation-set plan with the one-variable-per-variation map
    - Benchmark targets (cited, not inlined)

11. [AUTO] Write the brief to `outputs/ad-creative/meta-video-brief.md`.

## Outputs
- `outputs/ad-creative/meta-video-brief.md` containing:
  - Concept set (count per the canonical reference) with per-concept: hook opening, 4–6 word first-frame overlay, structure-by-temperature, target length-by-objective
  - Aspect-ratio plan per placement (values per the canonical reference) with safe-zone note (cited)
  - OEM/regulated early-branding or financial-disclaimer exceptions flagged per client where they apply
  - Variation-set mandate with one-variable-per-variation map and winner/fresh iteration ratio (cited)
  - Predictive benchmark targets (hook/hold/CTR/play-rate + conversions-per-variant) cited to the reference, flagged as targets not guarantees
  - Explicit citations to `frameworks/_shared/reference/meta-video-creative-2025-2026.md` for every perishable spec/number

## Success Criteria
- [ ] Ran only when platform includes Meta and creative format is video
- [ ] Concept count, durations, safe zones, and benchmarks are CITED to the canonical reference — no perishable numbers inlined
- [ ] Every concept has a hook-first opening, a 4–6 word first-frame overlay, and no opening logo (unless an OEM/regulated exception applies)
- [ ] Structure assigned by audience temperature (problem-first cold / offer-first warm) with intake citation
- [ ] Length set by objective; AR intent set per placement (9:16 primary, 4:5 Feed)
- [ ] OEM Ford/Mazda early-branding / financial-disclaimer exception encoded when intake declares it
- [ ] Variation-set mandate present (one variable per variation, winner/fresh ratio, multiple cover options)
- [ ] Benchmarks framed as targets, not guarantees
- [ ] Operator has reviewed the brief before it is handed to production

## Guardrails
- Reference: framework guardrails at `guardrails.md`, subsection "Meta video creative"
- Mode-specific: synthesize a brief from existing intake/outputs and the canonical reference only; no new data collection, no production
- Never inline perishable specs (px / durations / safe-zone % / CPM-CPA deltas / algorithm names / practitioner names) — cite the dated reference
- OEM/regulated branding mandates override the default hook-first / no-opening-logo rule; flag per client
- All benchmarks use target/hypothesis framing — "targets X%," never "will hit X%"
- Keep the brief client-agnostic in structure; client specifics come only from intake, never from the framework
