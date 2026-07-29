# livecanvas-mcp

Browser-driven installer for LiveCanvas (a WordPress page-builder plugin)
preset sections. Drives the actual LiveCanvas editor via Playwright rather
than writing `post_content` directly through `wp post update` — a raw DB
write bypasses the editor entirely (no history step, no partial CSS/JS sync,
no body-class injection the editor would normally apply on save). This is the
canonical install path if your build discipline says page design happens in
the page-builder editor, not via raw database writes.

## Prerequisites (per target page, one-time)

- The page must have LiveCanvas enabled: `wp post meta update <id>
  _lc_livecanvas_enabled 1`
- On a local/MAMP-style environment, LiveCanvas's `disable-ob-handling` option
  may need to be set: `wp option update lc_settings
  '{"disable-ob-handling":"1"}' --format=json`
- Deactivate tracking/cache/overlay/optimizer plugins for a clean console
  during automation

## Usage

```bash
WP_USER='admin' WP_PASS='...' \
  node tools/livecanvas-mcp/install-preset.mjs \
    --site http://your-site.local/ \
    --page-id 123 \
    --preset /abs/path/to/your-section.html \
    [--position append|prepend|after:CSS|before:CSS|replace] \
    [--show]               # show the browser instead of headless
    [--user-env WP_USER]   # env var holding admin username (default WP_USER)
    [--pass-env WP_PASS]   # env var holding admin password (default WP_PASS)
```

`--position` controls where the preset HTML lands relative to the page's
existing `main#lc-main` content: `append`/`prepend` to the whole block,
`replace` to overwrite it entirely, or `after:<CSS selector>` /
`before:<CSS selector>` to insert relative to a specific existing element.

## Exit codes

`0` success · `1` usage error · `2` login failure · `3` editor never reached
ready state · `4` preset file unreadable · `5` save failure · `6`
verification mismatch.

## Requires

`playwright` (the npm package). Credentials are read from whatever env vars
you name via `--user-env`/`--pass-env` (default `WP_USER`/`WP_PASS`) — this
tool doesn't read 1Password or Keychain itself; set the env vars from
wherever you keep them.
