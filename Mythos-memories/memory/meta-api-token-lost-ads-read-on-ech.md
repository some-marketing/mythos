---
name: meta-api-token-lost-ads-read-on-ech
description: "Meta API token lost ads_read on ECH ad account (OAuth #200, found 2026-07-30) — use Ads Manager UI via Chrome for ECH Meta reads until BM re-grant"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ec7a23f-c278-4150-aa59-71ff3c93dd5a
  modified: 2026-07-30T20:05:18.465Z
---

As of 2026-07-30 the Meta access token (1Password, via run-with-op.sh) gets **OAuth #200 "owner has NOT grant ads_management or ads_read"** on ECH act_10151393423266343 — API reads/writes fail even though the token resolves. It worked as recently as the 2026-07-09 analysis pull.

**Why:** sessions waste time debugging the token/wrapper when the failure is account-level permission; the fix (Business Manager re-grant) is operator-side.

**How to apply:** for ECH Meta data, go straight to Ads Manager / Events Manager in the operator's Chrome session (claude-in-chrome) — it's logged in and works. Ask the operator to re-grant ads_read in BM if API access is needed. Related: [[google-ads-client-returns-page-array]].
