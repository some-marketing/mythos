# Local personal-account glue

Small scripts for personal-account tasks a session can't do through a
connected MCP: fetching a specific Gmail attachment over IMAP, checking a
second Gmail mailbox's IMAP reachability, logging into Google Home via
Playwright, and (macOS-only) stabilizing the local Node binary's code-signing
identity so privacy prompts don't re-trigger on every Homebrew upgrade.

- `gmail-fetch-attachment.js --subject "..." --from ... --out-dir ...` -- downloads a matching attachment via IMAP.
- `gmail-home-imap-check.js` -- IMAP reachability/health check against the Google Home account.
- `google-home-login.js` -- Playwright login flow for a Google Home account.
- `macos-approve-node.sh` -- macOS code-signing stabilization for the local Node runtime (see the script's own header for `--create-identity` / `--apply` / `--firewall` usage).
- `lib/instance-secrets.js` -- shared secrets-file loader (env var first, falls back to a local `secrets/mythos.home.env` file; see `creds.config.json`).

## Setup

Copy `env.example` to `.env` (or export the vars directly), or create your own `secrets/mythos.home.env` and point `MYTHOS_HOME_SECRET_FILE` at it. See `creds.config.json` for the documented credential-resolution shape.

## Excluded from this port

Two files from the source directory did not port:

- **`gmail-imap-invoice-sweep.js`** -- its header comment carried a real personal email address as a worked example (hardcoded, not parameterized). The pattern (IMAP search across a set of invoice-vendor queries, JSONL output) is a reasonable one, but the source file itself named a real account, so it was excluded rather than scrubbed in place.
- **`moxie-expense-diff.py`** -- a deterministic reconciliation script between a Gmail-sweep expense ledger and a specific personal-finance product's (Moxie) P&L export, with real default file paths and vendor-alias tables built from one person's actual spending categories. The mechanism (diff two expense sources, flag missing/ambiguous/corrections) is generic, but the guts here are financial-data-shaped around one operator's real bookkeeping setup closely enough that only an architecture note would survive stripping -- not included in this pass rather than shipping a hollow stub.
