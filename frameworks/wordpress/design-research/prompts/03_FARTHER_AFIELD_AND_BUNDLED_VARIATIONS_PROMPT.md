# Farther-Afield Research & Bundled Variations Prompt

> **Purpose:** After prompts 01 and 02 have produced the intake-grounded research report and competitive summary, this prompt drives a second research pass that looks OUTSIDE the client's direct niche, synthesizes it into N distinct design directions, and produces a paired `mockup + one-page brief` bundle per direction for operator review.
>
> **Prerequisite:** Prompts 01 (`01_RESEARCH_PROMPT_INPUTS.md`) and 02 (`02_RESEARCH_PROMPT.md`) are complete. Their outputs (`completed_research_prompt.md`, the delivered research report, `COMPETITIVE_SUMMARY.md`, `FEATURE_MATRIX.md`, `intake.json`) exist in the project's `outputs/` tree.
>
> **Execution mode:** PATCH_ALLOWED (writes to `outputs/research-farther-afield/` and `outputs/variations-v1/`). No external system mutations. Research lanes are read-only browsing + synthesis. Mockup rendering uses the client's real brand photography assets — never stand-ins or stock substitutes for the hero/feature imagery.

---

## Inputs

Resolve these paths before dispatching:

| Input | Location | Role |
|---|---|---|
| `intake.json` | `outputs/intake.json` (or project root) | Client identity, service area, target audience |
| Research report | `outputs/design-research-report.md` (or the delivered 02 output) | The 13-section report from prompt 02 |
| `COMPETITIVE_SUMMARY.md` | `outputs/sites/COMPETITIVE_SUMMARY.md` | Direct-niche competitor audit — reference as "what NOT to be" only |
| `FEATURE_MATRIX.md` | `outputs/sites/FEATURE_MATRIX.md` | Direct-niche feature inventory — input to conversion architecture, not aesthetics |
| Brand photography path | `clients/{CODE}/{project}/shared/brand/photography/` or the project's `brand-assets/` dir | Real client imagery for mockup composition — resolve and verify existence before lane dispatch |
| Brand tokens (if present) | `outputs/brand-tokens.json` or equivalent | Any locked palette/type decisions |

If brand photography is absent, HALT and surface the gap to the operator before dispatching lanes. Mockups without real client imagery are not a valid deliverable under this prompt.

**For follow-on slices** (palette correction, variation re-author, mockup regen) launched via `/plan-task`: run the `docs/follow-on-inventory-checklist.md` 5-check enumeration before drafting plan JSON. Three confirmed misses on the {CLIENT_CODE} run before this checklist existed.

**For mockup output rendering:** prefer the Gemini SDK HTML mockup pattern (see `docs/gemini-html-mockup-pattern.md`) over nano-banana when output requires actual client likeness or production-mockup-grade HTML/CSS. Nano-banana is reserved for stylized palette/mood/composition exploration. See `docs/known-issues.md` (KI-1, KI-2) for failure modes that motivated this routing.

**Placeholder copy rule (KI-4):** any testimonial-shaped placeholder MUST use lorem ipsum body + attribution-free format, OR explicit `[testimonial pending — client to provide]` placeholder. Never invent named-source attributions. Both Claude and Gemini default to fabricating plausibility-shaped attributions if not constrained.

---

## Boundary Rule (non-negotiable)

**Direct-niche competitors are not a design source.** They are documented in `COMPETITIVE_SUMMARY.md` / `FEATURE_MATRIX.md` as reference for conversion architecture, feature parity, and "what NOT to inherit aesthetically." The design-grammar source for variations MUST come from the three farther-afield lanes below. If a lane report references a direct-niche competitor as a positive design source, reject that citation and require replacement.

---

## Step 1 — Three Parallel Farther-Afield Research Lanes

Dispatch three non-overlapping research lanes in parallel (separate subagents or research calls). Each lane produces one markdown file at `outputs/research-farther-afield/lane-{A,B,C}.md`.

**Lane selection is adaptable per client.** The three standard lanes below are the default starting point. If the client's positioning makes one lane clearly inapplicable, substitute a sibling category from the same adjacency space and record the substitution in the lane file's header. Do not collapse to fewer than three lanes.

### Lane A — Premium Personal Brand / Individual Expert

Pattern: **"Single human as the product."** Solo musicians, chefs, acclaimed authors, fine-art photographers, craftspeople with editorial-tier sites, independent designers, named consultants, solo practitioners.

Research goal: how does a single person present themselves at the premium tier — what does authority, presence, and restraint look like when the website IS the individual.

### Lane B — Event / Experience Services

Pattern: **"We come do a thing at your event."** High-end wedding photographers, boutique event designers, luxury speakers, private chefs, experiential-dining operators, destination officiants, mobile-experience brands.

Research goal: conversion architecture for trust-at-distance bookings — how does a site convey "worth flying in / worth the premium" and walk a cold visitor to an inquiry.

### Lane C — Luxury / Editorial / Cultural Institutions

Pattern: **Visual-language elevation.** Boutique fashion houses, arts institutions, theatre/dance/opera season microsites, boutique hospitality, editorial magazines, museum microsites, curated-retail.

Research goal: what does visual dignity look like when budget and taste aren't constraints — typography, palette restraint, imagery treatment, spatial rhythm.

### Per-Lane Deliverable

Each `lane-{A,B,C}.md` file must contain:

1. **Header block**
   - Lane letter + name
   - Selection rationale (why this lane fits this client)
   - Substitutions vs. default, if any

2. **8–12 site examples**, each as:
   - URL
   - Who/what (one sentence: name + what they sell / represent)
   - Specific design-grammar observations (nav pattern, hero treatment, type pairing, palette, imagery treatment, section rhythm, CTA placement — be specific)
   - **One element worth stealing** (the single highest-value move, named)
   - **Translatability rating 1–5** (1 = pure inspiration, unusable as-is; 5 = directly adoptable for this client)

3. **Lane synthesis** (½ page)
   - 3–5 cross-site patterns this lane surfaces
   - Which of those patterns plausibly translate to this client
   - Which feel like traps (out-of-context, pastiche risk)

### Dispatch Instructions

- Use parallel subagent dispatch (one worker per lane) with the same input bundle (intake.json + research-report excerpt covering target audience and brand positioning).
- Workers may browse the web read-only to collect evidence. They do NOT log in, submit forms, or mutate target sites.
- Workers MUST NOT use the direct-niche `COMPETITIVE_SUMMARY.md` as a source — it is passed to them only so they can confirm non-overlap.
- Each worker produces its lane file and returns the path. No mockup work in this step.

---

## Step 2 — Cross-Lane Synthesis & Variation Count

After all three lanes return, perform a synthesis pass and write `outputs/research-farther-afield/synthesis.md`.

The synthesis must answer:

1. **How many distinct design directions deserve variation treatment?** The answer is 2, 3, or 4 — driven by the evidence, not by a fixed template. Justify the count in one paragraph. Factors:
   - If two lanes converge on the same direction, that's one variation.
   - If one lane produces two genuinely distinct directions, that's two variations.
   - If a direction has <2 translatable sites backing it, it does not qualify as a variation.

2. **For each chosen variation:**
   - Slug (kebab-case, e.g. `editorial-restraint`, `experiential-warmth`, `single-voice-authority`)
   - Single-word design-style class (e.g. `editorial`, `conversion`, `portal`, `gallery`)
   - One-paragraph design-direction statement — what this variation *believes* about how the client should present (narrative stance, not just visuals)
   - Which lanes fed it (A/B/C, sites cited)

3. **Rejected directions.** Any direction considered and dropped, with the reason.

---

## Step 3 — Bundled Variation Deliverables

For each variation chosen in Step 2, produce TWO artifacts under `outputs/variations-v1/<variation-slug>/`:

### a) `mockup.png` — Full-scroll front-page render

- Full homepage scroll: nav → hero → social proof → offerings → CTA → footer. NOT a hero crop.
- Desktop viewport (1440w minimum). Mobile rendition optional as `mockup-mobile.png`.
- **Uses real client brand photography** from the resolved brand-photography path. If a section needs imagery the client hasn't provided, leave a clearly-marked `[CLIENT-IMAGE-NEEDED: <description>]` block rather than inserting stock or AI-generated substitutes.
- Copy may be placeholder/lorem where the research doesn't supply it, but headlines should reflect the variation's narrative stance.

### b) `brief.md` — One-page design brief

Use this template verbatim as the brief's section structure:

```
# <Variation Name> — Design Brief

**Slug:** <variation-slug>
**Class:** <single-word design-style class>
**Direction bundle:** outputs/variations-v1/<variation-slug>/

## Palette
- <hex> <named mood>, e.g. "#F4F1EC bone white"
- <hex> <named mood>
- <hex> <named mood> (accent)
- Palette mood statement: "<one phrase, e.g. 'theatre program dignity'>"

## Fonts
- Display: <font name>, weights <list>
- Body: <font name>, weights <list>
- Rationale: <why this serif / why this sans — era, feel, what it signals>

## Design Style
- Class: <one word>
- Elaboration: <one paragraph>

## Design Direction
- <one paragraph: what this variation believes about how the client should present — narrative stance, posture, what it asks of the visitor>

## Research Citations
- <Lane letter>: <site name> — <what we took: nav / hero / testimonial / rhythm / etc.>
- <Lane letter>: <site name> — <what we took>
- (minimum 3 citations, each naming a specific element taken)

## Why It Fits This Client
- Tie to research report: <specific audience finding or positioning statement>
- Tie to brand photography: <how the available imagery supports or constrains this direction>
- Tie to target audience: <what this direction does for the client psychology section of the report>
```

### Output Layout

```
outputs/
├── research-farther-afield/
│   ├── lane-A.md
│   ├── lane-B.md
│   ├── lane-C.md
│   └── synthesis.md
└── variations-v1/
    ├── <slug-1>/
    │   ├── mockup.png
    │   └── brief.md
    ├── <slug-2>/
    │   ├── mockup.png
    │   └── brief.md
    └── ... (2–4 total)
```

---

## Step 4 — Operator Review Unit

The bundle (`mockup.png` + `brief.md`) is the unit the operator picks from. Do not present mockup images in isolation. Direction-selection review reads every brief alongside its mockup and chooses one — or asks for a merged/new variation based on what the briefs surface.

Worked example (live): `clients/{CLIENT_CODE}/projects/wordpress__design-research__<project-slug>/outputs/research-farther-afield/` and `outputs/variations-v1/`. When that exercise completes, reference it here for future runs.

---

## Completion Criteria

This prompt is complete when:

- [ ] `outputs/research-farther-afield/lane-A.md`, `lane-B.md`, `lane-C.md` exist, each with 8–12 sites, per-site details, and lane synthesis.
- [ ] `outputs/research-farther-afield/synthesis.md` exists with a justified variation count (2–4) and a slug + direction statement per variation.
- [ ] For each variation, `outputs/variations-v1/<slug>/mockup.png` AND `outputs/variations-v1/<slug>/brief.md` both exist.
- [ ] Every `brief.md` contains all seven required sections (Palette, Fonts, Design Style, Design Direction, Research Citations with ≥3 cites, Why It Fits This Client).
- [ ] No brief cites a direct-niche competitor as a positive design source.
- [ ] Every mockup uses real client brand photography or marked image-gap placeholders — no stock substitutes.
