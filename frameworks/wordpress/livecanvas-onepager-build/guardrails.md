# wordpress/livecanvas-onepager-build — Guardrails

## Scope
- One new single-page marketing site on WordPress + Picostrap 5 + LiveCanvas, built on a
  password-gated / noindexed demo subdomain, then migrated to the client's domain. Multi-page
  builds and rebuilds of existing bloated sites are out of scope (see `wordpress/livecanvas-rebuild`).

## Safety
- Never inline wp-admin credentials, API keys or 1Password values in prompts, logs, page HTML or
  captures. Use an already-authenticated browser session or a 1Password item title.
- Never write client names, emails, phone numbers, addresses or photos into this framework tree.
  Client data lives under `clients/<CODE>/` only. Reference runs may cite the client code.
- Everything the client sees on the demo is a publishing decision: the demo must have
  "discourage search engines" on and a hosting-level password gate before the link is shared.
- No photo of the owner on the page unless the client has said yes. No testimonials, review
  counts, service-area towns, credentials or claims that do not trace to an approved source
  (questionnaire, call transcript, live-site copy, or a client message).
- No third-party brand marks in photos on the page (crop them out or skip the photo).

## Execution modes
- `FINDINGS_ONLY`: research, photo rating, licence checks, live-site review.
- `REVIEW_ONLY`: design-spec review, copy-provenance audit, mobile check.
- `PATCH_ALLOWED`: Customizer token writes, media uploads, LiveCanvas page/partial injection,
  Reading-settings toggle, Gmail *draft* creation. Sending email is the operator's action.

## Verification rules (non-negotiable)
- Every Customizer write: read back `wp.customize.state('saved')` and the dirty count, then curl
  `css-output/bundle.css` on the public URL and grep the tokens.
- Every LiveCanvas save (page or partial): wait ≥6 s after `updatePreview()`, click Save, wait ≥8 s,
  then curl the public URL with a cache-buster and grep for a marker that only the new content has.
  A save that is not curl-verified is unverified.
- Every build pass includes a phone-width capture from the LiveCanvas XS device emulator, not just
  desktop. Check: no horizontal overflow, navbar collapses, image/text bands stack image-first,
  call CTA ≥44 px tall.
- A fact corrected by the operator mid-build is grep-swept across every project artifact before
  the step is called done.

## Design rules learned on the reference run
- Rank design inputs: the client's verbatim words on the call > the client's existing brand
  assets > any AI-generated research report. The report fills gaps only where the client is silent.
- Check the logo font's web licence *live* (foundry, Adobe Fonts, resellers) before promising it;
  compare any "free look-alike" directly against the brand asset, not by name.
- The logo image is rarely usable at header height; ask for a horizontal lockup. The bolt/mark
  alone becomes the favicon (512×512 transparent PNG).
- Keep the hero shape without a photo until a hero-grade photo exists; do not force a proof-shot
  (panel, pipe, wiring) into the hero.

## Browser hygiene
- One Claude-in-Chrome tab per task, reused across batches, closed once at the end. Navigate by
  element (find/ref), record the flow, and write the navigation notes into the project's outputs.

## Reporting
- Use observational reporting: observations and hypotheses, not diagnoses. "The save reported
  success but the public HTML is unchanged" is a finding; "LiveCanvas is broken" is not.
- Completion claims carry the verification artifact (the curl output, the dirty count, the
  capture path), never an adjective.

## Pause conditions
- Stop and ask the operator when: a font/photo/hero decision is unresolved (S2b/S3-style gates),
  a plan is classified BIG and no convene evidence exists, the client's sign-off is required
  before the build proceeds, or a save cannot be curl-verified after two attempts.
