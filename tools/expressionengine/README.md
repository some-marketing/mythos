# tools/expressionengine — ExpressionEngine content-edit tool

On-device CLI tooling for editing ExpressionEngine channel-entry field
content and finding entries by title, via ExpressionEngine's own Control
Panel HTTP endpoints. Credentials are resolved locally; the password never
transits an LLM context, a log file, or stdout.

Bring your own EE site: everything below is parameterized by env vars or a
1Password item you point at your own installation. Nothing here is bound to
any specific site.

## What's here

- `ee-edit.js` — CLI: find/replace a channel-entry field's content, verify
  the change went live, log the run (never the password) to a JSONL file.
- `ee-find.js` — CLI: find an entry by title (or other criteria) across a
  channel listing, returning its entry id for use with `ee-edit.js`.
- `lib/ee-auth.js` — credential resolution (env → 1Password service-account →
  1Password ambient session → error) + CP login (POST credentials → capture
  session cookie → extract the login/edit-page CSRF token). Includes a
  Domain/Path/Secure/expiry-aware cookie jar and same-origin redirect
  enforcement (a credential-bearing POST redirected cross-origin is refused,
  never silently followed).
- `lib/ee-entry-edit.js` — apply a field edit against a resolved entry.
- `lib/ee-find-entry.js` — parse an EE CP listing page for entries matching
  a title/criteria.
- `lib/ee-verify.js` — confirm an edit is actually live on the public page
  (not just accepted by the CP).
- `test/` — 107 unit tests against recorded HTML fixtures (login forms,
  entry-edit pages, listing pages, failure pages) — no live site required to
  run the suite.

## Credentials

Three resolution paths, tried in order (see `lib/ee-auth.js` for the exact
mechanics):

1. **Env vars** `EE_URL`, `EE_USERNAME`, `EE_PASSWORD` — set all three to
   skip 1Password entirely (useful for CI or a quick one-off).
2. **1Password via a service-account token** — set `OP_SERVICE_ACCOUNT_TOKEN`,
   or store one in macOS Keychain (`security add-generic-password -s
   op-service-account-automation -a mythos -w <token>`). The tool isolates
   `HOME` for this call so a desktop `op` session doesn't interfere.
3. **1Password via your ambient desktop session** — if you're already signed
   into the `op` desktop app, no token is needed at all.

Either way, the 1Password item should hold your CP login URL (in the item's
URL field, not a named field), a username field, and a password field. See
`creds.config.json` for the exact field-resolution shape and `env.example`
for the env-var override path.

**Hard rule:** the password only ever lives in a JavaScript object in process
memory. It is never written to stdout, stderr, a log file, or disk anywhere
in this tool. `ee-edit.js`'s JSONL run-log never includes it.

## Usage

```bash
# Find an entry by title
node tools/expressionengine/ee-find.js --title "Your Entry Title" --channel-id 13

# Edit a field, dry-run first
node tools/expressionengine/ee-edit.js \
  --entry-id 101 --channel-id 13 \
  --field-name field_id_21 \
  --find "old text" --replace "new text" \
  --dry-run

# Live edit + verify against the public page
node tools/expressionengine/ee-edit.js \
  --entry-id 101 --channel-id 13 \
  --field-name field_id_21 \
  --find "old text" --replace "new text" \
  --public-url https://www.your-site.example/your-entry-url
```

Run `--help` on either CLI for the full flag list.

## Running the tests

```bash
node tools/expressionengine/test/ee-unit-tests.js
```

No live site or credentials needed — the suite runs entirely against
recorded HTML fixtures in `test/fixtures/`.

## Parser confidence

The entry-listing and entry-edit HTML parsers (`lib/ee-find-entry.js`,
`lib/ee-entry-edit.js`) were written against EE 6/7's publicly documented
admin markup conventions and the fixtures in `test/fixtures/`, not captured
from a specific live install. **Your first live run against your own site is
the real validation.** If a parser comes back empty, re-run with
`--debug-html` to capture the actual listing/edit-page HTML, then adjust the
selectors — one-line tweaks are typically sufficient (a title-cell selector,
an edit-link href pattern).

## A note on browser-driven automation

If the raw HTTP login POST above doesn't work against your EE install (some
server-side session/CSRF configurations reject a bare POST even with a
correct cookie jar and CSRF token), the fallback is driving an already
logged-in browser session directly — Playwright, or an interactive
browser-automation tool — rather than debugging the raw-HTTP path further.
Two DOM-level patterns worth knowing if you go that route:

- **File uploads without an OS dialog.** EE's file-upload inputs are
  ordinary `<input type="file">` elements. You can fetch a local file over
  `http://127.0.0.1:<port>` (Chrome treats `127.0.0.1` as a secure context,
  so this is exempt from mixed-content blocking even on an https page),
  construct a `File` from the response blob, assign it to the input via a
  `DataTransfer`, dispatch a `change` event, then call
  `input.form.requestSubmit()` — the submit buttons on EE's upload forms are
  typically form-associated via a `form=` attribute rather than form
  descendants, so `requestSubmit()` on the form itself is the reliable path,
  not hunting for a submit button inside it.
- **Field pickers ("Choose Existing" modals) are ordinary DOM**, not a
  native OS file picker — click the field's picker link, the modal lists the
  bound directory newest-first, click the target row's title cell, and the
  hidden field gets set directly. Synthetic drag-and-drop events onto a
  dropzone (`DragEvent('drop')` or a jQuery `drop` event) are reliably
  ignored by EE's entry-form dropzones — don't rely on that path.

These are general EE-CP automation patterns, not tied to any one site or
entry.
