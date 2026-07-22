# Meta Ads MCP

Local Meta ad operations for your client work. Writes are dry-run by default.

Current scope:

- list campaigns, ad sets, and ads
- export insights
- update ad status
- update ad set daily budget
- scaffold ad text updates in dry-run mode
- create campaigns, ad sets, ad creatives, and ads
- upload images and videos
- healthcare/audiology compliance preflight for creative writes

## Defaults

- Dry-run is on by default
- Live writes require both `META_ADS_DRY_RUN=false` and per-call `live=true`
- Supplying only one live signal still returns a dry-run payload
- Secrets are read from env or local env files
- Creative writes run compliance preflight; failed preflight hard-blocks live calls

## Environment

- `META_ACCESS_TOKEN` — required for live mode
- `META_AD_ACCOUNT_ID` — default ad account for list/export calls
- `META_API_VERSION` — optional, defaults to `v21.0`
- `META_GRAPH_BASE_URL` — optional, defaults to `https://graph.facebook.com`
- `META_ADS_DRY_RUN` — optional, defaults to `true`

## Tools

- `meta_list_campaigns`
- `meta_list_ad_sets`
- `meta_list_ads`
- `meta_export_insights`
- `meta_update_ad_status`
- `meta_update_ad_set_budget`
- `meta_update_ad_text` (scaffold-only)
- `meta_create_campaign`
- `meta_create_ad_set`
- `meta_upload_image`
- `meta_upload_video`
- `meta_create_ad_creative`
- `meta_create_ad`

## Create Flow

Expected dry-run order:

1. `meta_create_campaign`
2. `meta_create_ad_set`
3. `meta_upload_image` or `meta_upload_video`
4. `meta_create_ad_creative`
5. `meta_create_ad`

`meta_create_ad_creative` and `meta_create_ad` require a `compliance` object.
For healthcare/audiology work, the preflight blocks disability-inference
targeting, undocumented testimonial-like copy, unsubstantiated `free` claims,
and unverified registered-audiologist claims. In live mode, a block verdict
returns `mutation_attempted: false` before any Meta API request is attempted.

## Launch-Packet Dry Run

The launch-packet validation test consumes:

- `clients/patron-delta/projects/meta-creative-iteration/outputs/05-launch-packet/example-launch-packet-a.json`
- `clients/patron-delta/projects/meta-creative-iteration/outputs/05-launch-packet/example-launch-packet-b.json`
- `clients/patron-delta/projects/meta-creative-iteration/outputs/05-launch-packet/example-launch-packet-c.json`

It writes deterministic request fixtures to
`tools/mcp/meta-ads/__fixtures__/dry-run-output/{variant_id}.json` and asserts
that phone numbers in copy are verbatim, asset paths exist, and creative lander
URLs match the packet exactly.

## Run

```bash
npm run mcp:meta-ads
```

Preflight:

```bash
npm run mcp:meta-ads:preflight
```

## Notes

- `meta_update_ad_text` is scaffold-only right now. It validates payload shape and returns the intended mutation, but live creative mutation is intentionally not enabled yet.
- Budget changes target ad sets, not individual ads.
- Live launch against an ad account remains a separate operator-gated slice.
