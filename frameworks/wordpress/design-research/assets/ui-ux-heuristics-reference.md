# UI/UX Heuristics Reference

> **Provenance.** Distilled (re-expressed, not copied) from the open-source design-knowledge
> skill `ui-ux-pro-max`. Source: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>
> @ commit `bdf1179` (skill manifest v2.6.2; repo release tag ~v2.6.5).
> License: **MIT** — Copyright (c) 2024 Next Level Builder.
> Clean-room re-expression receipt: `reports/clean-room/receipts/ui-ux-heuristics.json`
> (verified non-verbatim via `tools/clean-room/clean-room.cjs`).
>
> **What this is NOT.** None of the source project's Python search engine, npm CLI, or
> platform install/symlink machinery was adopted. This file holds only the design knowledge,
> re-stated in Mythos's own words.
>
> **Scope.** Although this framework grew out of conversion-page (CRO) work, the guidance here
> is general-purpose visual and interaction design. Treat it as a reference for any web build,
> mockup, redesign, or design review — landing pages, full sites, dashboards, and components —
> not only CRO surfaces.

---

## How to use this reference

Reach for it whenever a task changes how something **looks, feels, moves, or is operated**:
new pages, new or reworked components, choosing a palette/type system, or reviewing an
existing interface that feels "off" without an obvious cause. Skip it for pure backend,
data-model, infra, or non-visual automation work.

Work the checklists in priority order — accessibility and touch/interaction failures hurt
users most, so clear those first; polish (typography micro-rules, chart niceties) comes last.

---

## 1. Visual design principles

### Color discipline
- **Anchor on a small, deliberate palette.** A reliable starting ratio is roughly
  60% dominant/background tone, 30% supporting tone, and 10% accent reserved for the
  thing you most want clicked. The accent should be scarce enough that it still reads as
  "the action."
- **Treat color as a token system, not loose hex values.** Name roles — primary, secondary,
  accent, surface, text-on-surface, error, success — and reference the names in components.
  Scattering raw hex codes through markup makes themes and dark mode unmaintainable.
- **Never let color carry meaning alone.** Pair every functional color (error red, success
  green, status dots) with an icon, label, or shape so colorblind and low-vision users get
  the same signal.
- **Design light and dark together.** Dark mode is not an inversion — use softer, lighter
  tonal variants and re-check contrast independently for each theme.

### Typography
- **Pair a heading face with a body face that have complementary personalities** (e.g. an
  expressive serif headline over a highly legible humanist sans body). Keep it to one pairing.
- **Use a consistent type scale** rather than arbitrary sizes (a modular ramp such as
  12/14/16/18/24/32). Body copy stays at 16px minimum on mobile to avoid forced zoom.
- **Give body text room to breathe:** line height around 1.5–1.75, and cap line length near
  65–75 characters so long passages stay readable.
- **Make hierarchy obvious through size, weight, and spacing** — headings should clearly
  outrank body text; reserve heavier weights (600–700) for headings, regular (400) for body.

### Layout, hierarchy, and scannability
- **Establish hierarchy with size, spacing, and contrast — not color alone.** The eye should
  land on the most important element first without being told.
- **Use a consistent spacing rhythm** (a 4/8px increment system) for padding, gaps, and
  section breaks; random spacing reads as sloppy.
- **Reserve space for content that loads later** (set image dimensions or aspect ratios) so
  the layout does not jump as assets and async data arrive.
- **Keep one primary call-to-action per screen;** secondary actions should look subordinate.
- **Constrain content width** for readability and define a deliberate z-index scale instead
  of reaching for arbitrarily large stacking values.

---

## 2. Anti-patterns to avoid

These are the moves that make an interface look amateur or unpleasant. The paired form is
"don't do X — do Y instead."

- **The default "AI" look — purple/pink gradients.** This generic gradient palette signals
  template output and undercuts credibility, especially for trust-sensitive verticals
  (finance, legal, medical, government, automotive). Choose a palette grounded in the brand
  and industry instead. (This is the single most repeated warning across the source's
  product-type guidance.)
- **Harsh or excessive motion.** Animating everything, long durations (>500ms for UI),
  bouncing decorative elements, and aggressive scroll-jacking/parallax cause distraction and
  motion sickness. Animate one or two meaningful elements per view, keep micro-interactions
  in the ~150–300ms range, use ease-out to enter / ease-in to leave, and always honor
  `prefers-reduced-motion`.
- **Hover-only interactions.** Effects that only appear on hover are invisible on touch
  devices — drive primary actions with tap/click and never hide critical affordances behind
  hover.
- **Emoji used as structural icons.** Emojis render inconsistently across platforms and can't
  be themed; use a single consistent vector/SVG icon set instead.
- **Mixing visual languages randomly** (flat next to skeuomorphic, thick strokes beside thin,
  filled icons beside outline at the same level). Pick one style and apply it consistently.
- **Gray-on-gray / low-contrast text** and other readability sins (tiny body text, full-width
  paragraphs). Keep text dark on light surfaces and meet the contrast floor below.
- **Layout-shifting press states** and animations that animate `width/height/top/left`
  (expensive repaints) — animate `transform`/`opacity` only, and don't reflow on press.
- **Silent failures and frozen UI.** Every async action needs feedback — a skeleton/spinner
  for waits over ~300ms, a clear error message with a recovery path, and confirmation on
  success. Disable submit buttons during processing to prevent double-submission.
- **Placeholder text as the only label**, errors dumped at the top of a form instead of next
  to the field, and destructive actions fired without confirmation.

---

## 3. Accessibility / WCAG checklist

Treat this as a gate, not a nicety — these are the highest-impact items.

### Contrast and color
- [ ] Normal body text meets **4.5:1** contrast against its background (large text 3:1; AAA target 7:1).
- [ ] Error/success state colors and small UI glyphs also clear 4.5:1 (3:1 for larger glyphs).
- [ ] No information is conveyed by color alone — icon, text, or shape always accompanies it.
- [ ] Dark-mode contrast is verified separately rather than assumed from light-mode values.

### Keyboard and focus
- [ ] Every interactive element shows a **visible focus indicator** (a 2–4px ring); never
      strip the outline without a clear replacement.
- [ ] All functionality is reachable by keyboard, with tab order matching visual order and no
      focus traps.
- [ ] After a transition or submit error, focus moves to the right place (main content region,
      or the first invalid field).
- [ ] Long, nav-heavy pages offer a "skip to main content" link.

### Pointer and touch
- [ ] Clickable elements use `cursor: pointer` and show a hover/active state on the web.
- [ ] Touch targets are at least **44×44px** with ~8px of spacing between adjacent targets;
      expand the hit area when the visual icon is smaller.

### Semantics and structure
- [ ] Meaningful images have descriptive `alt` text; icon-only buttons carry an `aria-label`.
- [ ] Headings follow a sequential hierarchy (h1→h2→h3) and aren't chosen for visual size.
- [ ] Semantic HTML/landmarks (`nav`, `main`, `article`) are used instead of generic `div`s.
- [ ] Form inputs have associated visible labels; errors are announced via `aria-live` /
      `role="alert"`, not signalled by color alone.

### Motion and scaling
- [ ] `prefers-reduced-motion` is respected — animations reduce or disable on request.
- [ ] Layout survives larger system text sizes / zoom without breaking or truncating content.

---

## 4. Pre-delivery quick pass

Before shipping a build or mockup, run the critical items once more: confirm contrast and
focus states, verify touch targets and `cursor: pointer`, check that nothing relies on hover
or color alone, test with reduced motion enabled, and validate dark mode contrast on its own.
Then sanity-check the look: a brand-grounded palette (no default AI purple/pink gradient),
consistent icon set, one clear primary CTA, and a steady spacing rhythm.
