# Gemini HTML Mockup Pattern

Authorized alternative to nano-banana for production-mockup-grade variation deliverables in this framework.

## When to use this instead of nano-banana

- Output must preserve actual client likeness (not AI-imagined likeness)
- Output must be production-mockup-grade (real layouts, not stylized exploration)
- Output must be portable to the build platform (Bootstrap 5 utility classes for LiveCanvas, etc.)
- Operator wants to iterate via design direction prompts rather than image-prompt re-rolls

## When nano-banana is still right

- Palette / mood / composition exploration
- Stylized hero artwork where AI-imagined likeness is acceptable
- Direction-finding before committing to HTML authoring

## Pattern

### Inputs (assemble per variation)

1. `intake.json` — client positioning truth
2. `outputs/variations-v1/palette-tokens.md` — palette source of truth
3. `outputs/variations-v1/{slug}/brief.md` — variation stance brief
4. `outputs/variations-v1/{slug}/current.html` — prior iteration if any (otherwise omit)
5. List of available client photo paths (relative from output directory)
6. Primary hero photo path for this variation

### Prompt template (per variation)

```
You are authoring a desktop homepage HTML mockup for {CLIENT_NAME} ({INDUSTRY}).

CLIENT INTAKE (her own words, source of positioning truth):
{intake.json verbatim}

PALETTE TOKENS (mandatory color contract):
{palette-tokens.md verbatim}

THIS VARIATION:
- Slug: {slug}
- Stance: {one-line stance from brief}
- Brief: {brief.md verbatim}

EXISTING MOCKUP (current iteration to upgrade from):
```html
{current.html or omitted}
```

AVAILABLE PHOTOS (relative paths):
{photo manifest}

PRIMARY HERO PHOTO: {hero photo path}

DESIGN DIRECTION (operator-overridable):
{1-8 design direction items — see SYSTEM_DIRECTION below}

OUTPUT FORMAT:
- Self-contained HTML with inline <style>
- Bootstrap 5 utility classes via CDN link
- CSS custom properties from palette-tokens.md
- Body sets background to var(--brand-black) and default text to var(--brand-off-white)
- Reference photos by relative path
- For testimonials: lorem ipsum body, NO fake attributions (NO invented publication names — see KI-4)
- Start with <!doctype html>, end with </html>
- No markdown fences, no commentary
```

### Standard SYSTEM_DIRECTION items (parameterizable per project)

1. Full-bleed dramatic heroes (no split-screen with empty negative space)
2. Oversized display typography (clamp(80px, 12vw, 200px) range for hero)
3. Brand color used confidently as a design BLOCK element, not just CTA accent
4. Asymmetric layout moves (off-grid, layered, rotated metadata)
5. Layered composition (type over image, mix-blend-mode, clip-paths)
6. Lorem ipsum testimonials and body filler — keep client positioning language but allow placeholder copy
7. Honor client positioning per intake (do not invent register or audience)
8. Honor venue-branding crops (object-position aggressive, gradient overlays for problematic regions)

### Tooling

Project-specific reference implementation: `tools/gemini/author-html.mjs` (production-validated).

Generalized tooling proposal (replicate-plan R-2): `tools/gemini/author-html-mockup.mjs` with framework-agnostic input contract. Accepts a `mockup-config.json` declaring intake path, palette path, brief path, photo manifest, primary hero, and design-direction overrides. Currently project-specific; generalization deferred to next replicate cycle.

### Render-to-PNG

Use Playwright headless Chrome at desktop 1440x900, deviceScaleFactor 2, fullPage screenshot. Reference implementation: `clients/<CODE>/projects/<project>/outputs/mockup-renders-v3/render.mjs`.

### Critique pass (optional but recommended)

After rendering, dispatch a Gemini 2.5 Pro vision critique on each PNG with the same intake + palette + brief + stance context. Returns design + copy assessment with specific evidence cites. Reference: `tools/gemini/critique.mjs`.

## Cost / quota notes

- Gemini 2.5 Pro: each authoring call is roughly 8-15K tokens out + ~5K in (intake + palette + brief). Cost per variation ~$0.03-0.05 at current pricing.
- Critique calls: ~3K tokens out + image input. Cost per critique ~$0.01-0.02.
- Three variations + three critiques per project: ~$0.20 total. Cheap relative to nano-banana retry cycles.

## Known limitations

- Gemini will fabricate testimonial attributions if not explicitly told to use lorem ipsum + attribution-free format. See KI-4. Always include the constraint in the prompt.
- Output HTML quality varies per pass. Re-running with explicit critique-driven adjustments is normal (1-2 passes typical).
- Bootstrap utility class usage is consistent but requires CDN access at render time. Self-host if rendering offline.

## Provenance

Pattern validated on a production palette-faithful variation-regen workstream.
- `clients/<CODE>/projects/<project>/outputs/mockup-renders-v3/{slug}-v2.{html,desktop.png}`
