# Credential Acquisition Checklist

Operator-facing checklist for getting the local credentials required by the Meta Ads and Google Ads MCP scaffolds.

Use this with:

- [meta-ads setup](meta-ads/SETUP.md)
- [google-ads setup](google-ads/SETUP.md)
- [root env example](../../../.env.example)

## Storage Rule

Put real values only in:

- `.env.local`
- `.env`
- `~/.mythos/.env`

Never commit real tokens or secrets.

## Meta Ads

### Required values

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`

### Where they come from

1. Go to Meta Business Manager / Business Settings.
2. Confirm the business owns or has access to the target ad account.
3. Create or identify a Meta developer app with the Marketing API product enabled.
4. Create or identify a system user under Business Settings.
5. Assign the target ad account to that system user.
6. Generate a system user access token with:
   - `ads_read`
   - `ads_management`
   - `business_management`
7. Copy the ad account ID for the account you want to test.

### What goes in env

```bash
META_ADS_DRY_RUN=false
META_AD_ACCOUNT_ID=<ad-account-id-without-act_>
META_ACCESS_TOKEN=<system-user-token>
```

### Sanity check

Run:

```bash
META_ADS_DRY_RUN=false npm run mcp:meta-ads:preflight -- --live-check
```

Expected result:

- `ready_for_live_reads: true`
- `live_check.ok: true`

## Google Ads

### Required values

- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`

Optional but often needed:

- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`

### Where they come from

1. Confirm the Google user has access to the target Google Ads account.
2. If access is through an MCC/manager account, note that manager account ID.
3. In Google Ads API Center, generate or copy the developer token.
4. In Google Cloud Console, create or use an OAuth client ID and client secret.
5. Run an OAuth consent flow for the Google user with Ads access and obtain a refresh token.
6. Copy the target customer ID and remove dashes.
7. If applicable, copy the login customer ID and remove dashes.

### What goes in env

```bash
GOOGLE_ADS_DRY_RUN=false
GOOGLE_ADS_CUSTOMER_ID=<customer-id-without-dashes>
GOOGLE_ADS_LOGIN_CUSTOMER_ID=<manager-id-without-dashes-if-needed>
GOOGLE_ADS_DEVELOPER_TOKEN=<developer-token>
GOOGLE_ADS_CLIENT_ID=<oauth-client-id>
GOOGLE_ADS_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_ADS_REFRESH_TOKEN=<oauth-refresh-token>
```

### Sanity check

Run:

```bash
GOOGLE_ADS_DRY_RUN=false npm run mcp:google-ads:preflight -- --live-check
```

Expected result:

- `ready_for_live_reads: true`
- `live_check.ok: true`

## Recommended Order

1. Get Meta credentials first and run the Meta live preflight.
2. Get Google Ads credentials next and run the Google Ads live preflight.
3. Only after both read checks pass, move on to real bounded write proofs.
