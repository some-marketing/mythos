# Google Ads MCP Scaffold

Phase 1 scaffold for local Google Ads operations.

Current scope:

- search-based reads for campaigns, budgets, and conversion actions
- export/report queries
- bounded campaign status updates
- bounded campaign budget updates

## Defaults

- Dry-run is on by default
- Live mode requires `GOOGLE_ADS_DRY_RUN=false`
- Secrets are read from env or local env files

## Environment

- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — optional manager account header
- `GOOGLE_ADS_CUSTOMER_ID` — default customer for reads and writes
- `GOOGLE_ADS_API_VERSION` — optional, defaults to `v20`
- `GOOGLE_ADS_DRY_RUN` — optional, defaults to `true`

## Run

```bash
npm run mcp:google-ads
```

Preflight:

```bash
npm run mcp:google-ads:preflight
```

## Notes

- Live mode uses REST search and mutate scaffolding with refresh-token auth.
- Text/creative mutation is intentionally out of Phase 1 scope. This scaffold is focused on reads, status changes, budget changes, and reporting.
