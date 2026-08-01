# Stage 5 — Cutover

**Mode:** PATCH_ALLOWED (production, single window) · **Output dir:** `clients/{CODE}/projects/{slug}/rebuild/cutover/`

## Purpose

Move the verified staging build to production within a single named window, with a documented rollback path.

## Inputs

- A staging build that has cleared Stage 4 acceptance.
- An operator-approved cutover window.
- A pre-cutover production database backup (host-level + plugin-level).

## Steps

1. **Pre-cutover backup.** Take a fresh full backup of production (DB + files). Verify the backup is restorable.
2. **Freeze production.** Put the live site into maintenance mode for the cutover window. This is the only legitimate use of LightStart-style maintenance plugins in this framework.
3. **DNS / file / DB cutover.** Either: (a) swap DNS from production to staging URL after a final db sync, or (b) sync files + DB from staging to production in place. Pick before the window opens.
4. **Smoke tests on production:** homepage, product list, single product, cart, checkout (live mode roundtrip with a real card or sandbox test card), contact form, transactional email, GTM page-views and conversions.
5. **Reverse-tunnel any pending orders or admin sessions** that started during the freeze.
6. **Lift the freeze.**
7. **Post-cutover monitoring** for 48 hours: 5xx rate, conversion rate, real-user metric (LCP, CLS), inbound transactional emails.

## Rollback

The rollback path is the pre-cutover backup. It must be restorable in under 30 minutes. If smoke tests fail and cannot be fixed forward within the cutover window, restore the backup, lift the freeze, and reschedule.

## Acceptance

Cutover is complete when:
- Production runs the rebuilt site.
- All Stage 4 acceptance criteria hold against production.
- 48-hour monitoring window closes with no regressions worse than pre-cutover baseline.
- A `outputs/cutover-report.md` documents what was done, what was tested, and any open follow-ups.
