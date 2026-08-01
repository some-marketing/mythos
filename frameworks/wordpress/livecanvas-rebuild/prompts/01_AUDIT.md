# Stage 1 — Audit

**Mode:** FINDINGS_ONLY · **Output dir:** `clients/{CODE}/projects/{slug}/captures/` and `outputs/`

## Purpose

Produce a decision-grade picture of the source site's technical surface: stack, plugin sprawl, page-builder ownership, commerce complexity, weight, SEO issues. This stage is read-only; it never mutates the source site.

## Inputs

- `intake.json` with at minimum: `site_url`, `op_item_title` (1Password admin credential item), `goal` (preserve / soft-relaunch / showcase / sell), `host_notes` (free-form).

## Steps

1. **Sitemap discovery.**
   `curl -sL {site_url}/robots.txt` to find sitemaps. Common paths: `sitemap.xml`, `sitemap_index.xml`, `wp-sitemap.xml`, `sitemaps.xml`.
2. **Plugin inventory** (admin-side, via the operator's already-authed Chrome session, OR via Playwright with auth cookies):
   visit `/wp-admin/plugins.php` and capture all rows: name, slug, active/inactive/update status. Same for `?plugin_status=mustuse`. Save to `captures/plugins-inventory.md`.
3. **Authed Playwright crawl** of every URL in the sitemap:
   - Use `audit-crawler.mjs` ({CLIENT_CODE} reference) as the starting point.
   - Login via `wp-login.php`; harvest cookies; reuse across the crawl.
   - Per page, capture: title, meta description, canonical, h1 count, body classes, builders detected, commerce signals (PAO field count, variations, price text, stock badge), widget signals (revslider, popupMaker, ninjaForms, brevoForm), affiliate signals, scripts/CSS/DOM weight, plugin slugs from asset URLs, theme slugs from asset URLs.
   - Concurrency 4. Save raw `site-audit.jsonl` and aggregate `site-audit-summary.json`.
4. **Per-page synthesis** (Haiku subagent task):
   from the JSONL, identify which pages own real builder content, which pages have widgets vs runtime-only assets, which products use PAO and how many fields, which pages are missing H1, and which pages are heaviest. Write to `captures/per-page-findings.md`.

## Bypassing maintenance gates

Many target sites run LightStart / "Coming Soon" / Maintenance Mode plugins that gate anonymous traffic. The crawler MUST be able to log in via `wp-login.php` to see the real site. Credentials never enter chat or argv — see `guardrails.md` for the credential pattern.

## Acceptance

Stage 1 is complete when:

- `captures/site-audit.jsonl` exists with one record per URL and zero crawl errors (or all errors are explained).
- `captures/site-audit-summary.json` exists with builder, widget, plugin, and weight aggregates.
- `captures/plugins-inventory.md` lists every active and inactive plugin.
- `captures/per-page-findings.md` cites specific URLs (no inventions) for builder owners, slider, popups, forms, affiliate, and PAO-bearing products.
- `outputs/current-site-analysis.md` summarizes the headline numbers for an operator read.

## Anti-patterns observed in the {CLIENT_CODE} reference run

- **Don't trust regex selectors for PAO field counts.** `[class*=wc-pao]` matches wrappers, labels, and inputs. Use `.wc-pao-addon-container` or the addon-group selector explicitly.
- **Don't conflate plugin-runtime presence with widget-instance presence.** Popup Maker assets load on every page; the popups themselves only render on a few. Aggregate both signals.
- **Don't crawl anonymous if the site has maintenance mode.** You'll get 104 copies of the same maintenance page.
