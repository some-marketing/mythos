# Stage 4 — Staging Promotion

**Mode:** PATCH_ALLOWED (staging only) · **Output dir:** `clients/{CODE}/projects/{slug}/rebuild/staging/`

## Purpose

Promote the verified local build to a staging URL where DNS, SSL, CDN, real payment-gateway live mode, real shipping rates, and host-level caching can be tested before cutover.

Staging is *not* the rebuild — the rebuild already exists locally. Staging proves the rebuild survives reality.

## Inputs

- A working local rebuild from Stage 3.
- A staging environment provisioned on the target host (1-Click Web Apps, WP Engine, Kinsta, etc.) with a non-indexed staging URL.

## Steps

1. **Database export from local; import to staging.** Use WP CLI's `db export` + search-replace for URL rewrites: `wp search-replace '{CLIENT_CODE}.local' 'staging.{CLIENT_CODE}.com'`.
2. **File migration.** Sync `wp-content/uploads/`, `wp-content/themes/`, and `wp-content/plugins/` from local to staging. Don't sync `wp-content/cache/` — let staging regenerate.
3. **DNS / SSL / robots.** Confirm staging URL has SSL, robots.txt blocks indexing, and `/wp-login.php` is reachable.
4. **Live-mode integration tests.** Switch payment gateways from test/sandbox to live (where billing matters), placing real low-value orders against the staging URL — refund immediately. Test shipping rate API. Test transactional email flows actually deliver to inboxes.
5. **Host caching layer.** Confirm the host's caching strategy is compatible with WooCommerce's cart/checkout pages (those should never be cached). Adjust W3 Total Cache or replace with host-native caching as the host requires.
6. **Audit crawler against staging** with the same crawler used in Stage 1 and Stage 3. The staging numbers should match the local numbers within rounding error.

## Acceptance

Stage 4 is complete when staging passes all the Stage 3 acceptance gates *plus*:
- Real payment-gateway live mode roundtrips (one test order placed and refunded for each gateway).
- Real shipping API returns rates for at least one product going to at least one address in each currency zone.
- Transactional email actually delivers (Brevo / SMTP test).
- Crawler-measured weight comparison holds within ±5% of local.
