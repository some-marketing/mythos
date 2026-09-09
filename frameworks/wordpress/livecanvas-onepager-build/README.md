# wordpress/livecanvas-onepager-build — Framework Candidate

**Status:** candidate (`v0.1.0`) — Iron. One reference run; not yet replayed.
**Origin:** distilled from the first reference run (client code `BRE`, `clients/BRE/`), 2026-09-09.
Capture bundle: `clients/BRE/projects/wordpress__content-editing__one-pager-site/captures/20260909T134835Z__livecanvas-onepager-build`.

## When to use

A local trades or service business (electrician, plumber, HVAC, landscaper…) needs a **new**
single-page marketing site, the agency stack is WordPress + Picostrap 5 + LiveCanvas, and the
inputs are a kickoff form, a kickoff call, a business card or logo, and a handful of the client's
own jobsite photos. The primary audience arrives on a phone, often in a hurry.

For gutting an existing bloated multi-page site, use `wordpress/livecanvas-rebuild` instead.

## Prompt chain

| Stage | Prompt | Mode | Purpose |
|---|---|---|---|
| 1 | `01_INTAKE_AND_RESEARCH.md` | RUN_ONLY | Context bundle (transcript, answers, assets, photo rating), research with brand facts pinned (reports-only writes) |
| 2 | `02_DESIGN_SPEC.md` | REVIEW_ONLY → PATCH_ALLOWED | Concept, sourced copy, visual spec (tokens, font-licence reality), wireframe; distinct-mind review |
| 3 | `03_THEME_TOKENS.md` | PATCH_ALLOWED | Picostrap Customizer tokens via the JS API; verified in `bundle.css` |
| 4 | `04_PAGE_BUILD.md` | PATCH_ALLOWED | Media, page HTML, header/footer partials, favicon via the LiveCanvas API; curl-verified; XS emulator check |
| 5 | `05_CLIENT_REVIEW.md` | PATCH_ALLOWED | Design-direction review email as a Gmail draft in the operator's voice; operator sends |

`docs/picostrap-livecanvas-recipe.md` is the mechanical core: the `SCSSvar_*` setting map, the
LiveCanvas `setPageHTML('main#lc-main', html)` injection recipe, partial editing, favicon, and the
save-verification rules learned the hard way.

## Reusable assets from the reference run

- Picostrap Customizer setting map (colours, type, radii, buttons) with verified values.
- LiveCanvas page skeleton: hero (half-pill panel, phone-first stacking), trust strip, services
  grid, alternating photo bands, story band, older-wiring explainer, electrification upsell,
  homeowner/business columns, gallery, service area, contact, footer partial.
- Header partial modelled on a sticky navbar with a 6 px primary bar, logo, anchor nav, phone CTA.
- Favicon builder (Pillow) that cuts the mark from a horizontal lockup onto a 512×512 transparent PNG.
- Client review email template (why the direction, what is placeholder, what we need) in the
  operator's register.

## Promotion criteria

Move this candidate to a stable framework when:

1. Stage 4 has been run end-to-end on **three** different client sites, each capture normalized
   and attached as evidence (`workspace:capture` → `normalize` → `candidate:scaffold`).
2. The Customizer + LiveCanvas recipe has been turned into a script
   (`tools/wordpress/picostrap-apply.js` + `livecanvas-set-page.js`) with a curl-verify step, so
   Stage 3–4 tier down from a frontier mind to a script.
3. Each reference run carries a client sign-off on the design direction (Stage 5 answered).
4. The plan for the reference run has passed a distinct-mind review and, for BIG (client-facing)
   plans, convene evidence.
5. `candidate.json` for the scaffolded candidate shows `promotion_ready: true` after
   `replay-candidate.js` preflight.

Time alone does not graduate this. Silence is not consent.
