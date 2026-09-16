# 04 — Page Build (LiveCanvas)

## Objective
Put the reviewed content on the demo site as a phone-first LiveCanvas page with header and footer
partials, brand media and favicon, with every save proven on the public URL.

## Mode
PATCH_ALLOWED

## Inputs
- `plans/<slug>__content.md`, `__wireframe.md`, `__visual-spec.md`
- Rated photos and logo exports from the context bundle
- Optional: a previous LiveCanvas page from the agency as a markup-conventions reference

## Steps
1. **Media**: upload the logo exports and the hero-quality photos via
   `wp-admin/media-new.php?browser-uploader` (a plain file input); read URLs back from
   `/wp-json/wp/v2/media`. WordPress renames >2560 px files `-scaled` and auto-rotates EXIF
   portrait shots (`-rotated`).
2. **Author the page HTML** locally under `outputs/home-page__lc-html__v1.html` in LiveCanvas
   conventions: one `<section>` per band, `.lc-block` wrapper on every editable unit,
   `editable="inline"` for single-line text, `editable="rich"` for paragraphs, plain Bootstrap 5
   utilities, `bg-white` / `bg-light` alternating, image bands with `order-1/order-2` so phones
   stack image-first. Put page-scoped CSS in one `<style>` block at the top (hero panel shape,
   rounded cards, letter-spacing helper).
3. **Inject**: open `?lc_action_launch_editing=1`, run
   `setPageHTML('main#lc-main', html)` then `updatePreview()`, wait ≥6 s, click the top-bar Save,
   wait ≥8 s, then curl the public URL with a cache-buster and grep a marker only the new page
   has (section count, an id, an image basename). Unverified saves do not count.
4. **Header and footer**: enable "Use LiveCanvas to design the header/footer" in the LiveCanvas
   backend; this creates `lc_partial` posts with slugs `header` and `footer`. Edit them via
   `?lc_partial=header&lc_action_launch_editing=1` with the same recipe. Header: `sticky-top`,
   6 px primary bar, horizontal logo at ~52 px, anchor nav, phone CTA pill. Footer: logo, address,
   phone, email, credentials line. Remove any footer band from the page body once the partial exists.
5. **Favicon**: cut the mark from the horizontal lockup onto a 512×512 transparent PNG, upload,
   then `wp.customize('site_icon').set(<id>)` + `wp.customize.previewer.save()`; verify the
   `<link rel="icon">` tags on the public page.
6. **Phone check**: in the editor, click the XS device toggle (≈412 px). Confirm no horizontal
   overflow, navbar collapses to a hamburger, hero panel becomes a rounded band above the headline,
   bands stack image-first, CTA ≥44 px tall. Save a desktop and an XS capture to `outputs/recordings/`.
7. **Iteration with the operator**: apply each direction (shape, border, image in/out, gallery)
   the same way — edit in `doc`, `updatePreview()`, settle, Save, curl-verify — and keep the local
   HTML file in sync after every accepted change.
8. **Correction sweep**: when the operator corrects a fact, fix the live page, then
   `grep -rl` the old value across the project and fix every artifact.
9. Leave the contact form as a clearly labelled placeholder until the form plugin is installed and
   the client has signed off on the layout.

## Outputs
- `outputs/home-page__lc-html__v1.html`, `header-partial__lc-html__v1.html`, `footer-partial__lc-html__v1.html`
- Media ids and URLs recorded in the setting-map doc
- Desktop + XS captures under `outputs/recordings/`

## Success Criteria
- Public URL: expected section count, zero blueprint/sample residue, every uploaded image
  referenced, `lc-header`/`lc-footer` present, favicon links present.
- XS emulator: no overflow, collapse works, image-first stacking, CTA tap target ≥44 px.
- Local HTML files match what is live (spot-check three markers).

## Guardrails
- One browser tab per task; close it at the end.
- No photo of the owner without a yes. No third-party brand marks in frame.
- Do not force a proof-shot into the hero; keep the shape with the logo until a hero photo exists.
