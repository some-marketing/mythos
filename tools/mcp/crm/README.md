# CRM MCP

Provider-pluggable agency-CRM integration lane. Moxie (withmoxie.com) is
provider #1. Read-only in v1.

## Status: read lane confirmed against a live probe

An operator-gated live-read probe against a real Moxie workspace confirmed
the provider paths, response envelope, and fixture field shapes in this lane
— not guesses.

Confirmed facts:

- **Auth**: `X-API-KEY` header. Per-workspace base URL ending `/api/public/`.
- **Endpoints** (relative to the base URL):
  - `action/clients/list` — all clients (each with nested `contacts`).
  - `action/contacts/search` — all contacts (empty `query` returns all).
  - `action/projects/search` — all projects (empty `query` returns all).
  - `action/users/list` — workspace users.
  - `action/payableInvoices/search` — see the invoice-history wall below.
- **Envelope**: every list/search endpoint returns a **bare JSON array**.
  There is **no** `{ data, meta }` wrapper and **no** `meta.has_more`. The
  `page`/`per_page` params are accepted but ignored — the provider does
  **not** paginate.
- **Invoice-history wall**: `action/payableInvoices/search` returns **only
  currently-payable (outstanding) invoices**. During the probe it returned
  `[]` for every documented status value (all/paid/unpaid/sent/draft/partial/
  overdue/open) and every query. `action/invoices/*`, `action/payments/*`,
  `action/expenses/*`, and `action/timeWorked/*` all return **404**. The
  public API does **not** expose invoice history or payments.
- **Pivot for bookkeeping**: historical billing data comes from the
  logged-in Moxie **web app (browser lane)**, not this API. This lane covers
  the CRM identity/read surface (clients, contacts, projects, users, and
  outstanding invoices) only.

This lane remains **read-only** and **dry-run by default** (`CRM_DRY_RUN`
defaults to `true`). No credential value is ever printed or logged;
`run-with-op.sh` only resolves the key into a child process env.

## Design Rules (mirrors `tools/mcp/meta-ads/`, `tools/mcp/sheets/`)

- Local-only auth: secrets come from environment variables, local env files,
  or the 1Password resolver — never hardcoded.
- Dry-run first: `CRM_DRY_RUN` defaults to `true`.
- Read-only in v1: `client.js` and `providers/moxie.js` implement GET/list
  operations only. No create/update/delete Moxie call exists in this code,
  by design — write-back is out of scope until the read lane is proven (see
  plan "Required gates").
- No secret logging: nothing in this lane prints credential bytes.

## Wiring credentials at build time

1Password item/vault are confirmed: **`mythos-moxie-api-credentials`** in
vault **`Automation`**. The **field labels** on that item were confirmed at
the 2026-07-08 live wiring:

- The API key lives in the field labelled **`credential`**.
- The per-workspace base URL lives in the field labelled **`base url`**
  (host + `/api/public/`, no scheme — `config.js` normalizes it to HTTPS).

`run-with-op.sh` maps those labels to `MOXIE_API_KEY` / `MOXIE_BASE_URL`; if
the labels ever change, override `CRMOP_FIELD_API_KEY` / `CRMOP_FIELD_BASE_URL`
(see the `run-with-op.sh` header comment).

Run any script through the resolver:

```bash
tools/mcp/crm/run-with-op.sh node <your-script>.js
```

## Environment

See `env.example`. Key variables:

- `CRM_PROVIDER` — active provider id. Only `moxie` exists today.
- `CRM_DRY_RUN` — defaults to `true`.
- `CRM_WRITE_ENABLED` — second write-lane gate, defaults to `false`. A live
  write (POST) requires BOTH `CRM_DRY_RUN=false` AND `CRM_WRITE_ENABLED=true`.
  See "Write lane" below.
- `MOXIE_BASE_URL` — per-workspace, not publicly discoverable.
- `MOXIE_API_KEY` — required for live mode.
- `MOXIE_RATE_LIMIT_MAX_REQUESTS` / `MOXIE_RATE_LIMIT_WINDOW_MS` — Moxie's
  documented limit is 100 req / 5 min per workspace (confirmed 2026-06-30);
  these are config surface only in this scaffold (no request-count
  enforcement is wired up yet — the client currently only reacts to a real
  HTTP 429 with backoff, it does not pre-emptively throttle).
- `MOXIE_MAX_RETRIES` / `MOXIE_RETRY_BASE_DELAY_MS` — 429 retry/backoff
  tuning for `client.js`.

## Files

- `run-with-op.sh` — 1Password → macOS Keychain service-account → env
  credential resolver, mirroring `tools/mcp/meta-ads/run-with-op.sh`.
- `config.js` — env-driven config loader (provider selection, dry-run
  default, Moxie base URL/key/rate-limit/retry settings).
- `client.js` — HTTP client. Sends `X-API-KEY`. Retries on HTTP 429 with
  exponential backoff (or `Retry-After` header if present). `get()` for reads;
  `post()` for the gated write lane (inert unless both write gates are open —
  see "Write lane").
- `providers/moxie.js` — provider abstraction. Reads (`listClients`,
  `listContacts`, `listProjects`, `listInvoices`, `listUsers`, plus v1.1
  `listFormNames`, `listTaskStages`, `listPipelineStages`,
  `listEmailTemplates`, `listInvoiceTemplates`, `listVendors`) each do a single
  `client.get()` and normalize the bare-array response (no pagination). Writes
  (`createInvoice`, `applyPayment`, `createClient`, `createContact`,
  `createProject`, `createTask`, `createTimeEntry`, `createExpense`,
  `createOpportunity`, `createFormSubmission`) POST via `client.post()` and are
  inert by construction. Exports `READ_METHODS`, `WRITE_METHODS`, and the
  combined `PROVIDER_SHAPE` so a future CRM provider satisfies the same
  contract without call sites special-casing Moxie.
- `probe.js` / `scan-paths.js` — live read-only probe utilities used for the
  2026-07-08 endpoint confirmation. Sanitized output only (shapes/counts,
  never field values).
- `pull.js` — read-lane runner. Pulls every confirmed read endpoint via the
  provider and writes raw JSON to the gitignored data dir (default
  `clients/YOUR_AGENCY/finance/raw/`). GET-only; logs counts, never values. The
  outstanding-invoices endpoint is written as `payable-invoices.json` (not
  `invoices.json`) so it is never mistaken for full invoice history.
- `export-billing.js` — bookkeeping export CLI. Reads the raw pull + an
  optional harvested billing dataset and writes accountant-ready CSVs to the
  gitignored `clients/YOUR_AGENCY/finance/export/` dir. See "Billing export" below.
- `billing/export.js` — pure billing transforms (CSV rendering, invoice
  register, payments, monthly summary, engagements, MRR). No I/O.
- `billing/schema.js` — the Billing interchange shape (invoices +
  payments) that the browser lane harvests into. Provider-neutral.
- `env.example` — placeholder env vars only.
- `__fixtures__/moxie/` — fixture JSON for each endpoint. Field shapes were
  confirmed against the 2026-07-08 live probe; all VALUES are entirely
  synthetic (no real client data). Each fixture carries a `_note` recording
  the probe provenance; items live under `data`.
- `__tests__/` — offline node:test suite (config defaults, dry-run/live/
  retry client behavior via injected transport+sleep, provider path
  selection + bare-array normalization, billing transforms, and read-lane
  dry-run wiring). No network access in any test.

## Read lane + billing export

Two commands, both writing only into the gitignored `clients/YOUR_AGENCY/finance/`
data dir (real financial data — never committed):

```bash
# 1. Pull raw CRM data (live; needs the 1Password-resolved credentials).
tools/mcp/crm/run-with-op.sh node tools/mcp/crm/pull.js
#    → clients.json, contacts.json, projects.json, users.json,
#      payable-invoices.json  under clients/YOUR_AGENCY/finance/raw/

# 2. Build accountant-ready CSVs from the raw pull (+ any harvested billing).
node tools/mcp/crm/export-billing.js
#    → invoice-register.csv, payments.csv, monthly-summary.csv,
#      engagements.csv, recurring-monthly-summary.csv  under .../finance/export/
```

The export deliberately keeps **two financial lanes separate** so an
accountant never mistakes contracted terms for issued money:

- **Contracted lane** (`engagements.csv`, `recurring-monthly-summary.csv`) —
  derived from `projects.json` + `clients.json`, which the public API exposes
  today. This is what the agency is *engaged to bill* (active project fee
  terms; monthly recurring revenue by currency), **not** what has been
  invoiced or collected.
- **Transactional lane** (`invoice-register.csv`, `payments.csv`,
  `monthly-summary.csv`) — issued invoices and received payments. **The Moxie
  public API does not expose these** (invoice history / payments 404; see the
  probe findings). They are harvested from the logged-in Moxie **web app
  (browser lane)** into the Billing interchange shape
  (`billing/schema.js`), written to `clients/YOUR_AGENCY/finance/raw/billing.json`,
  and consumed by the export. Until that harvest lands, these three CSVs are
  **header-only** — the export never fabricates rows.

## Write lane (v1.1 — exists, inert by construction)

The write lane is built but **cannot make a live write** without deliberate,
gated action. It lives entirely at the library level:

- `client.js` `post(pathname, body)` and `providers/moxie.js` write methods
  (`createInvoice`, `applyPayment`, `createClient`, `createContact`,
  `createProject`, `createTask`, `createTimeEntry`, `createExpense`,
  `createOpportunity`, `createFormSubmission`).

**Two independent gates.** A live POST happens only when BOTH
`CRM_DRY_RUN=false` AND `CRM_WRITE_ENABLED=true`. In every other state `post()`
returns an inert descriptor (`{ dry_run: true, method: 'POST', path, body }`)
and makes no network call. The descriptor carries the **relative path only** —
never the full URL — so the per-workspace base URL cannot leak (same rule as
the read-lane redaction).

**No write CLI runner, on purpose.** There is intentionally no executable
script that calls a write method. A live write therefore requires (1) both env
gates open, (2) new wiring that constructs a write-capable client and calls a
provider write method, and (3) **per-call operator approval** per the plan's
escalation triggers. The library surface + inert descriptors let writes be
built and tested without any risk of an accidental live mutation.

**Provisional payloads.** Write endpoint paths come from the community OpenAPI
(secondary evidence); the request-body shapes are **unverified**. Every write
method's JSDoc says so — confirm the exact payload at the first operator-gated
live call before trusting any write for real data.

**Forms.** Form *names* are listable (`listFormNames`) and form *submissions*
are writable (`createFormSubmission`), but form **responses are NOT readable**
via the public API, and form **design is UI-only**. For reading form responses,
use the webhook or browser lanes (see the probe findings).

## Deviations from the mentor pattern

- **No `server.js` / MCP stdio surface yet.** `tools/mcp/meta-ads/` and
  `tools/mcp/sheets/` both expose an MCP tool server (`server.js`,
  `tools.js`). This lane intentionally stops short of that: the confirmed
  provider (paths + bare-array envelope) is in place, but the MCP tool
  surface (`server.js`/`tools.js`) is deferred until the read lane is wired
  into a caller.
- **`client.js` takes an optional `deps` param** (`{ requestJson, sleep }`)
  that meta-ads's `client.js` doesn't need, purely so the 429 retry/backoff
  logic can be tested offline with a fake transport and instant fake sleep
  instead of real timers/network.
- **Default posture on `run-with-op.sh` differs slightly**: meta-ads's
  wrapper defaults to live mode once it resolves real credentials
  (`META_ADS_DRY_RUN:=false`) because meta-ads has an implemented write
  path guarded by that flag. This wrapper does the same for consistency
  (`CRM_DRY_RUN:=false` once wired). The read lane is live-capable, but
  every method here is GET-only — there is no write path to guard.

## Run tests

```bash
node --test tools/mcp/crm/__tests__/*.test.js
```
