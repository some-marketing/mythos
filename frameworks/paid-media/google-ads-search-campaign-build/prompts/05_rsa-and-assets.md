# 05 — RSA and Assets

- Step ID: 05
- Name: rsa-and-assets
- Execution mode: PATCH_ALLOWED (against preview bundle only; no live mutation)

## Goal
Compose Responsive Search Ads and ad-level assets (sitelinks, callouts, structured snippets, calls, images, promotion, price, lead form) for each ad group, with pin discipline and asset coverage documented.

## Inputs expected
- Step 02 ad-group topology.
- Step 04 keyword plan (for relevance alignment).
- Step 01 brand voice notes, compliance language, landing pages.
- Offer details, unique mechanisms, proof, urgency levers.

## Process
1. For each ad group, compose at least 1 RSA. Per RSA: up to 15 headlines and up to 4 descriptions. Minimum viable: 8-12 headlines, 3-4 descriptions.
2. Pin discipline: pin at most 1-2 headline slots for required elements (brand in H1, required legal in H2). Over-pinning collapses the RSA into a glorified ETA and suppresses Ad Strength.
3. Apply the 23-pillars copy playbook as a checklist when generating headlines — cover multiple angles (benefit, proof, urgency, specificity, objection-handle, differentiator, direct-offer) rather than restating the same angle in 12 variants.
4. Ensure keyword themes from the ad group appear in the headlines (dynamic-insertion or manual). Relevance to the ad-group theme drives Quality Score.
5. Compose ad-level assets:
   - Sitelinks: 4+ with descriptions, each pointing to a distinct page intent.
   - Callouts: 6+ benefits/proof nuggets.
   - Structured snippets: at least 1 relevant header (Services, Types, Brands, etc.).
   - Call asset: if phone conversions matter — bind to a call-tracking setup (finalized in step 06).
   - Image assets: on-brand, recent, no text-heavy overlays.
   - Lead form / promotion / price: if the offer supports them.
6. Compliance pass: remove unverifiable superlatives, medical/legal claims, prohibited characters, and double-punctuation. Flag anything that should be reviewed by the client.
7. Produce the preview bundle: per-ad-group asset files in preview-bundle-compatible JSON shape. This step's PATCH_ALLOWED applies to the bundle files only — not to the live account.
8. Ad Strength target: Good or Excellent per RSA before advancing.

## Output artifact
`outputs/google-ads-search-campaign-build/05_rsa-and-assets/` (directory) with per-ad-group RSA+asset JSON files + a summary `README.md` covering: Pin Discipline Applied, Compliance Flags, Ad Strength per RSA, Asset Coverage Matrix.

## Gates before advancing
Copy gate: RSAs meet minimum headline/description counts, pin discipline is documented, asset coverage matrix complete, compliance flags surfaced, no verbatim copyrighted source text reproduced in any asset.

## Distilled principles

**Write for the system AND the searcher.** RSA machinery rewards variety and pin restraint; searchers reward specificity and proof. The overlap of both is where performance lives.
- Evidence basis: Ed Leake, Planning/RSA Optimisation 2023 + 23 Pillars Ad Copy Playbook + Ad Copywriting Cheat Sheet. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: regulated verticals where claim restrictions collapse the variety — pin discipline may need to increase by policy, and Ad Strength is sacrificed on purpose.

**Assets are part of the ad, not extras.** Sitelinks, callouts, and structured snippets materially increase CTR and SERP real estate. Treating them as optional is a tax on every click.
- Evidence basis: Ed Leake, Building/Ad Extensions Become Assets. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: single-offer microsites with no diverse intent destinations — sitelink diversity may genuinely be low, and fewer, stronger sitelinks beats padding.
