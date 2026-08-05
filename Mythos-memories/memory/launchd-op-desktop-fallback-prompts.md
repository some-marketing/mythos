---
name: launchd-op-desktop-fallback-prompts
description: Any op field-lookup miss falls back to 1Password desktop auth and raises an unanswerable macOS Automation prompt in scheduled jobs — set OP_BIOMETRIC_UNLOCK_ENABLED=false and pre-set unused fields
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0d8f293b-db95-4614-8cb5-3b8dceed87a3
  modified: 2026-08-02T20:58:57.493Z
---

`run-with-op`-style wrappers read several optional fields (app id, secret, account id,
API version, base URL). Any field missing from the service-account vault falls through to
`env -u OP_SERVICE_ACCOUNT_TOKEN op read`, which uses 1Password **desktop integration** and
triggers macOS's "op would like to access data from other apps" Automation prompt — once
per missing field, per invocation.

**Why:** In an interactive session you just click Allow and never notice. In a launchd job
running every 10 minutes for an unattended week, it is five unanswerable prompts per cycle
and a stalled automation. Caught 2026-07-31 only because the operator screenshotted the
prompt during the SDAS launch sprint.

**How to apply:** In every scheduled/headless wrapper, `export OP_BIOMETRIC_UNLOCK_ENABLED=false`
(service-account auth needs no desktop app; a miss then fails quietly to defaults) AND
pre-set the optional env vars the wrapper would otherwise look up. Verify with a real
read-only API call before trusting it. Clicking Allow is harmless in itself but fixes
nothing for the unattended case. Related: [[op-service-account-token-precedence]],
[[meta-ads-run-with-op-is-live-mode]].

**SUPERSEDING FIX, validated 2026-08-02:** `OP_BIOMETRIC_UNLOCK_ENABLED=false` is NOT
sufficient — a fully-hardened wrapper (watcher-cycle) still hung for hours, because app
integration is a property of the ACCOUNT in the active op config dir, and every invocation
with a connected-account config attempts the desktop handshake regardless of token auth.
The real fix: `export OP_CONFIG_DIR="${OP_CONFIG_DIR:-$HOME/.config/op-headless}"` — an
isolated config dir with NO linked account; validated with zero tccd AUTHREQ events during
live probes while the desktop app ran; the operator's interactive Touch ID integration is
untouched. Applied 2026-08-02 to meta-ads and delesign wrappers; apply to any run-with-op
wrapper BEFORE it is ever scheduled. Full diagnosis:
`_dev/reports/analysis/op-prompt-noise__20260802.md`.
