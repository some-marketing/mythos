# wordpress/livecanvas-rebuild — Framework Candidate

**Status:** candidate (`v0.1.0`)
**Origin:** distilled from the LMF Props (`clients/{CLIENT_CODE}/`) reference run, 2026-05-06.

## When to use

Reach for this framework when an existing WordPress site has the classic "I have inherited this" stack:

- A heavy multipurpose theme (TheGem, Avada, BeTheme, Salient, Bridge, etc.)
- Two page builders running simultaneously (Elementor + WPBakery is the canonical case)
- A long tail of plugins (typically 30+ active) with redundant security / payment / slider stacks
- Slider Revolution, Popup Maker, Visual Composer leftovers
- Nominal multilingual (WPML / Polylang) that may or may not have real translations
- Shopify-envy admin UI that the operator dreads logging into

The output is a leaner site on **LiveCanvas + Bootstrap**, with WooCommerce preserved when commerce is real, while load-bearing data (products, reviews, payments, shipping, GTM, SEO) carries through unchanged.

## What it does NOT do

- It does not replace WooCommerce. (See the {CLIENT_CODE}-run `outputs/fluentcart-vs-woocommerce.md` for the reasoning.)
- It does not migrate Product Add-ons configurations automatically — those still need a hand-authored re-bind.
- It does not auto-evaluate whether multilingual content is real; it provides a probe for that.

## Prompt chain (proposed)

| Stage | Prompt | Purpose |
|---|---|---|
| 1 | `01_AUDIT.md` | Sitemap discovery + authed Playwright crawl + builder/widget/PAO/plugin classification + per-page findings |
| 2 | `02_DECISION.md` | Decide stack disposition (keep Woo? drop WPML? consolidate security? identify dormant plugins via probes) |
| 3 | `03_STAGING_REBUILD.md` | Stand up staging WP + LiveCanvas + chosen plugins; port catalog in batches (simple → variations → PAO) |
| 4 | `04_CUTOVER.md` | Validate Stripe/PayPal/shipping/email on staging; DNS cutover; post-launch monitoring |

## Reference run

The LMF Props execution at `clients/{CLIENT_CODE}/projects/wordpress__design-research__current-site-analysis/` exercised stages 1–2 fully. That project's `captures/` and `outputs/` folders are the canonical example of what each stage produces. Re-runs of stage 1 should produce structurally identical artifacts.

## Reusable assets from the {CLIENT_CODE} run

- `audit-crawler.mjs` — Playwright crawler with sitemap discovery + per-page audit
- `run-authed-crawl.sh` — 1Password-driven runner (credentials never enter chat or argv)
- 4 Haiku probe scripts (WPML / Toolset / Affiliate / generic plugin) — pattern, not generic
- `migration-readiness.md` schema — the decision-grade summary template

## Promotion criteria

Move this candidate to a stable framework when:

1. Stage 1 has been run end-to-end against three different WordPress sites, producing structurally consistent artifacts.
2. Stage 3 has been run at least once to a staging URL with a measured before/after weight comparison (scripts, CSS, DOM nodes, LCP).
3. The PAO re-bind workflow is documented well enough for a different operator to execute.
4. A `templates/` directory exists with the LiveCanvas starter (header / footer / product / category / page) abstracted from the {CLIENT_CODE} reference build.
