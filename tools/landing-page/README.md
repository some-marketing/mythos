# Landing-page sync/recon engine

Playwright-driven tooling for managing WordPress landing pages through the
wp-admin editor UI (no REST/DB write path required). Already generic in
the source repo — all four scripts use a placeholder client post-type
(`clienta_landing_page`) and placeholder site URLs
(`https://www.client-a.example`, `https://client-a-staging.example`); no
real client, credential, or site is hardcoded.

- **`recon-landing-pages.js`** — logs into wp-admin, inspects the landing
  page post type, maps editor fields, checks the REST API, and documents
  findings. Run this first against a new site to learn its editor shape.
- **`create-landing-pages.js`** — creates landing pages by filling the
  wp-admin editor form, from a JSON data file you supply via `--data`.
- **`update-landing-pages.js`** — updates existing landing page drafts by
  slug with full content, from a JSON data file.
- **`sync-landing-content.js`** — end-to-end pipeline: extracts HTML from
  production landing pages, pushes it into staging drafts via TinyMCE HTML
  mode, and verifies the result.
- **`lib/editor-helpers.js`** — shared Playwright helpers for filling
  WordPress editor fields (auto-detects TinyMCE vs. plain textarea).

```bash
node tools/landing-page/recon-landing-pages.js \
  --user your-wp-admin-user --pass "password" --output-dir _dev/reports/landing-page-recon/

node tools/landing-page/create-landing-pages.js \
  --user your-wp-admin-user --pass-file /tmp/.wp-pass \
  --data tools/landing-page/page-data.json \
  --output-dir _dev/reports/landing-page-creation/
```

Adjust the post type name (`clienta_landing_page`), the site URL constants,
and `--data` file to match your own WordPress site and content model. All
four scripts default to `--headed`-off (headless) and non-destructive
modes (draft-save, dry-run) unless you explicitly pass `--publish` /
`--apply`-style flags — check each file's own usage header.
