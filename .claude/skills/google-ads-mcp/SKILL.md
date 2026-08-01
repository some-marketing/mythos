---
name: google-ads-mcp
description: >
  Uses the Mythos local Google Ads MCP server (tools/mcp/google-ads) for MCC-aware
  discovery, GAQL reads, and bounded mutates. Prefer API tools over browser automation
  when credentials are configured.
version: 1.0.0
---

<skill>
<objective>
Operate Google Ads through the repo MCP lane: discover leaf customer IDs under an MCC,
run explicit-leaf reads and reports, then apply bounded mutates only after dry-run review.
</objective>

<execution_rules>
  <rule id="mcc-context">
    Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager account and pass **leaf**
    `customer_id` on every data-plane tool. Use `google_ads_list_accessible_customers`
    and `google_ads_list_client_accounts` before guessing IDs.
  </rule>
  <rule id="dry-run-first">
    Keep `GOOGLE_ADS_DRY_RUN=true` until dry-run payloads are reviewed; flip to false
    only for intentional live execution.
  </rule>
  <rule id="wrong-account-guard">
    Before mutates, confirm leaf `customer_id` and MCC header match the intended client.
  </rule>
  <rule id="gaql-safety">
    Prefer named tools over raw GAQL; use `google_ads_run_gaql` only with allowlisted
    FROM resources and LIMIT ≤ 500.
  </rule>
</execution_rules>

<quick_start>
1. `npm run mcp:google-ads:preflight` — env sanity
2. `google_ads_list_client_accounts` or `google_ads_list_accessible_customers` — pick leaf id
3. Read tools (`google_ads_list_campaigns`, `google_ads_list_ad_policy_summary`, …)
4. Mutates last — dry-run output must match intent
</quick_start>
</skill>
