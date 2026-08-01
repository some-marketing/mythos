# Meta Ads MCP Setup

## Purpose

Local Phase 1 tooling for:

- reading campaigns, ad sets, and ads
- exporting insights
- updating ad status
- updating ad set budget

## Step 1: Create local secrets

Put the required values in either:

- repo `.env.local`
- repo `.env`
- `~/.mythos/.env`

Recommended keys:

```bash
META_ADS_DRY_RUN=true
META_API_VERSION=v21.0
META_GRAPH_BASE_URL=https://graph.facebook.com
META_AD_ACCOUNT_ID=<default-ad-account-id-without-act_>
META_ACCESS_TOKEN=<system-user-token>
```

Keep `META_ADS_DRY_RUN=true` until you are ready for a real read-only test.

## Step 2: Confirm Meta access

You need:

- Meta business app with Marketing API product
- system user token
- `ads_read`
- `ads_management`
- `business_management`
- explicit access to the target ad account

## Step 3: Dry-run preflight

```bash
npm run mcp:meta-ads:preflight
```

This checks env loading and reports whether the lane is still dry-run or live-ready.

## Step 4: Live read-only proof

Switch to live mode:

```bash
META_ADS_DRY_RUN=false npm run mcp:meta-ads:preflight -- --live-check
```

That performs a bounded campaign list call with `limit=1`.

## Step 5: MCP server

```bash
npm run mcp:meta-ads
```

## Current Phase 1 limits

- `meta_update_ad_text` is scaffold-only
- no audience edits
- no targeting edits
- no campaign creation
- no media upload

---

## Example Group BM lane (multi-client through one app)

The original "Step 1" path above assumes one ad account in env. **Example Group Business Manager** (`business_id=<your-business-manager-id>`, owner: the BM owner) holds multiple client ad accounts (patron-alpha, patron-beta, patron-gamma, future the owner's other client accounts). One Meta App + one shared system user + one shared token authenticates **every** ad account in that BM. Ad account IDs are identifiers passed at call-time, not credentials.

### How credentials flow

- 1Password item: **`Example Group BM Meta App`** in the vault named by local `MYTHOS_PERSONAL_VAULT`.
- Item fields (no ad account IDs on the item): `META_ACCESS_TOKEN`, `META_APP_ID`, `META_APP_SECRET`. Optional: `META_API_VERSION`, `META_GRAPH_BASE_URL`.
- Ad account IDs live in `clients/<CLIENT>/projects/meta-app-integration/project.json` under `meta_integration.ad_account_id`. Adding a new dealership is a one-file change with no Meta-side, 1Password-side, or MCP code change.

### Run the wrapper for the Example Group BM lane

`run-with-op.sh` is parameterized via `METAOP_ITEM` and `METAOP_VAULT`; bind real values only in ignored local configuration:

```bash
METAOP_ITEM="Example Group BM Meta App" \
METAOP_VAULT="${MYTHOS_PERSONAL_VAULT:?set MYTHOS_PERSONAL_VAULT}" \
  tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/preflight.js
```

The shared token is exported to the child-process env only; nothing is persisted to keychain or .env files. Token bytes never appear in argv.

### Compliance preflight

`tools/mcp/meta-ads/compliance-preflight.js` runs before any creative-write call (`meta_update_ad_text` and any future `meta_update_creative`). Posture is resolved by `ad_account_id` against the matching client `project.json`. Block-on-fail by default; explicit `compliance.override_reason` records the override but does not erase the underlying failures from the audit verdict.

For patron-alpha specifically: patron-alpha sells used auto financing → Meta classifies it as a financial-services special-ad category. Creative writes for the patron-alpha ad account require `compliance.special_ad_category_acknowledged=true` AND, if the creative is AI-generated/altered, `compliance.ai_disclosure_present=true`.

### Operator gates (handoff checklist)

- **G1** Register the Meta App at https://business.facebook.com/latest/settings/apps?business_id=<your-business-manager-id> under Example Group's BM. Add Marketing API product.
- **G2** Create one shared system user under Example Group's BM and assign it access to **all three currently-in-BM ad accounts** (patron-alpha, patron-beta, patron-gamma — operator confirmed 2026-04-30 these are already inside the BM) plus any future the owner's other client accounts. Grants: `ads_read`, `ads_management`, `business_management`. Blast-radius: a leaked token grants writer access to every assigned ad account; mitigation is 1Password-only resolution + rotate-on-suspected-compromise.
- **G3** Generate the long-lived system-user token. Verify in Meta's token debugger; if pasting the debugger output as evidence, redact the token field first.
- **G4** Create 1Password item `Example Group BM Meta App` in your personal vault with the fields listed above. Populate each client `project.json` with its ad account ID (no IDs on the 1Password item).
- **G5 (closed)** App Review is **NOT** required for this app — it acts only on the owner's ad accounts inside the owner's BM (standard-access). **Re-open trigger:** if scope ever expands to non-the owner's ad accounts (cross-business-manager, partner-shared, agency-pattern), G5 must be re-opened and App Review submitted before any live writes.

### Adding patron-beta and patron-gamma later

1. Create `clients/patron-beta/projects/meta-app-integration/project.json` (or `clients/patron-gamma/...`) mirroring the patron-alpha project file with the matching ad account ID and client-specific compliance posture (patron-beta/patron-gamma are automotive — typically not special-ad-category, but follow the same AI-disclosure / no-fabricated-endorsement rules).
2. No 1Password change. No `run-with-op.sh` change. No MCP code change.
