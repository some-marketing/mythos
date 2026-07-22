# Google Ads MCP Setup

## Purpose

Local Phase 1 tooling for:

- reading campaigns and budgets
- inspecting conversion actions
- exporting reports
- updating campaign status
- updating campaign budgets

## Step 1: Create local secrets

Put the required values in either:

- repo `.env.local`
- repo `.env`
- `~/.mythos/.env`

Recommended keys:

```bash
GOOGLE_ADS_DRY_RUN=true
GOOGLE_ADS_API_VERSION=v20
GOOGLE_ADS_CUSTOMER_ID=<customer-id-without-dashes>
GOOGLE_ADS_LOGIN_CUSTOMER_ID=<manager-id-without-dashes-if-needed>
GOOGLE_ADS_DEVELOPER_TOKEN=<developer-token>
GOOGLE_ADS_CLIENT_ID=<oauth-client-id>
GOOGLE_ADS_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_ADS_REFRESH_TOKEN=<oauth-refresh-token>
```

Keep `GOOGLE_ADS_DRY_RUN=true` until you are ready for a real read-only test.

## Step 2: Confirm Google Ads access

You need:

- Google Ads manager or direct account access
- developer token
- OAuth client credentials
- refresh token for the authenticated Google user
- target customer ID
- login customer ID if working through an MCC

## Step 3: Dry-run preflight

```bash
npm run mcp:google-ads:preflight
```

This checks env loading and reports whether the lane is still dry-run or live-ready.

## Step 4: Live read-only proof

Switch to live mode:

```bash
GOOGLE_ADS_DRY_RUN=false npm run mcp:google-ads:preflight -- --live-check
```

That performs a bounded campaign read query with `LIMIT 1`.

## Step 5: MCP server

```bash
npm run mcp:google-ads
```

## Current Phase 1 limits

- no ad text mutation yet
- no campaign creation
- no broad batch updates
- budget updates are bounded to explicit budget resource IDs
