---
name: google-ads-client-returns-page-array
description: tools/mcp/google-ads client.runGaql returns an ARRAY of searchStream pages — reading .results directly yields 0 rows silently; also ECH needs MCC header 4326889678
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ec7a23f-c278-4150-aa59-71ff3c93dd5a
  modified: 2026-07-30T20:05:13.124Z
---

`createGoogleAdsClient(...).runGaql()` (tools/mcp/google-ads/client.js) returns an **array of searchStream page objects**, not one response. `r.results` on the raw return is `undefined` → loops silently see 0 rows (this bug is live in `ech-geo-inventory-20260611.js`, which prints undefined fields).

**Why:** silent-empty results look like "account has no campaigns" and have misled sessions into wrong conclusions.

**How to apply:** always flatten first: `const flat = r => (Array.isArray(r)?r:[r]).flatMap(p => p.results||[])`. Also: ECH (customer 8873951954) requires `GOOGLE_ADS_LOGIN_CUSTOMER_ID=4326889678` — the default env MCC points at a different manager and returns 0 rows too. Related: [[meta-api-token-lost-ads-read-on-ech]].
