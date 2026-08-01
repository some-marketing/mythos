# Stage 3 — Local Rebuild

**Mode:** PATCH_ALLOWED (local only) · **Output dir:** `clients/{CODE}/projects/{slug}/rebuild/`

## Purpose

Stand up a local WordPress install, install LiveCanvas + the keep-list plugins, port content + catalog, and verify the rebuild end-to-end *before* any staging URL is provisioned.

The LiveCanvas-rebuild framework starts local. Local is not "the cheap stage before staging" — it is the canonical first build environment, where iteration cost is lowest and breakage costs nothing. Staging exists later to validate that the local build runs against real DNS / SSL / CDN / payment gateways.

## Inputs

- Stage 2's `outputs/migration-readiness.md` (the keep / replace / drop disposition).
- A working local WordPress instance (LocalWP, MAMP, Docker, etc.) with a fresh DB.
- A copy of the source site's database export, OR a one-shot WP CLI migration tool, OR manual product import — operator picks the data path.

## Steps

1. **Local environment.** Operator stands up a local WP at a host like `{CLIENT_CODE}.local`. Confirm: WP version matches or exceeds source, PHP version matches, MySQL/MariaDB available.
2. **Install LiveCanvas + the keep-list plugins** from Stage 2. Skip everything in the drop list.
3. **Theme.** Use the LiveCanvas starter theme (or LiveCanvas Lite). Author header / footer / page templates as Bootstrap-native HTML. No page-builder.
4. **Catalog port — three batches:**
   - Batch A: simple products (no variations, no PAO). Use WP CLI or Woo's CSV importer.
   - Batch B: products with native Woo variations.
   - Batch C: products with Product Add-ons. Re-bind addon field groups by hand from the Stage 1 captures; don't trust automated re-import.
5. **Static pages port.** For each non-product page in the sitemap, port the visible content into LiveCanvas templates. Pages that were owned by WPBakery / Elementor in Stage 1 are re-authored, not lifted.
6. **Functional verification (local):**
   - Add to cart works for one simple product, one variation product, one PAO product.
   - Checkout works (Stripe + PayPal in test mode, or sandbox).
   - Customer Reviews import (if applicable) shows the review history.
   - GTM tag fires on page load and on add_to_cart.
   - Forms submit (locally, with a test endpoint).
7. **Weight comparison.** Run the same audit-crawler against the local URL. Capture before / after for: scripts, CSS, DOM nodes, total transfer. The before/after comparison is the framework's success metric.
8. **Capture the rebuild as evidence.** Write `outputs/rebuild-plan.md` with:
   - Local URL and how to access it
   - Plugin list installed (compare to source, mark each "kept / replaced / new")
   - Catalog migration metrics (counts, errors, manual fixes)
   - Weight comparison table
   - Open issues to fix before staging promotion

## Acceptance

Stage 3 is complete when:

- The local rebuild responds at its local URL with a working homepage, product list, single product page, cart, checkout, and contact form.
- Weight comparison shows measurable improvement on at least 3 of 4 metrics (scripts, CSS, DOM, transfer).
- `outputs/rebuild-plan.md` exists with the evidence above.
- Operator has reviewed and confirmed that nothing they need has been silently dropped.

## Anti-patterns

- **Don't skip the catalog re-bind for PAO products** — automated import + manual re-bind is fine; pure automated import almost always misses required-flag and option-list nuances.
- **Don't run the local rebuild's audit-crawler with the same selectors as Stage 1 if any selectors changed in LiveCanvas.** The before/after comparison is only fair if the methodology is identical.
- **Don't promote to staging if any keep-list integration (payments, shipping, email) hasn't been tested locally.** Local payment gateways usually have sandbox/test modes; use them.
