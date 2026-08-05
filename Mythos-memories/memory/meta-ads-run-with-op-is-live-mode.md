---
name: meta-ads-run-with-op-is-live-mode
description: tools/mcp/meta-ads/run-with-op.sh sets META_ADS_DRY_RUN=false — scripts run under it mutate LIVE on first invocation; there is no implicit dry-run
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 80410a59-7221-4409-9dbd-82da51069ccc
  modified: 2026-07-31T15:32:15.495Z
---

`tools/mcp/meta-ads/run-with-op.sh` puts the client in **live mode** (`dryRun=false`), overriding
the config default of `META_ADS_DRY_RUN=true`. A mutation script run under the wrapper fires real
Graph API writes on its first run.

**Why:** discovered 2026-07-31 — a pause script intended as a dry-run first pass executed live
immediately (outcome was operator-authorized and correct, but the intent was staged).

**How to apply:** for a true dry run under the wrapper, set `META_ADS_DRY_RUN=true` explicitly in
the command env (it must win over whatever the wrapper exports — verify the script logs
`dryRun=true` before trusting it). Always check the `dryRun=` line the script prints before
assuming anything about what the run will do.
