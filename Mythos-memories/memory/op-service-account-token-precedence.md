---
name: op-service-account-token-precedence
description: "A globally exported OP_SERVICE_ACCOUNT_TOKEN silently breaks every run-with-op wrapper whose 1Password service account it doesn't belong to — scope tokens per leg, never per process"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0d8f293b-db95-4614-8cb5-3b8dceed87a3
  modified: 2026-07-31T17:58:00.598Z
---

The 1Password CLI gives `OP_SERVICE_ACCOUNT_TOKEN` in the environment absolute
precedence over both keychain-resolved tokens and the desktop-app session. SM_OS has
MULTIPLE service accounts with different vault views (sm_os/smos-1p-automation-token
for the SDAG deploy wrapper; the meta-ads wrapper expects mythos/mythos-1p-automation-token,
which as of 2026-07-31 does NOT exist in the keychain — its interactive success was the
desktop-app fallback, unavailable under launchd).

**Why:** Exporting one account's token process-wide made the meta wrapper read the wrong
vault view and fail ("item isn't in the Automation vault") even though authentication
succeeded — a confusing half-working state that cost three live launchd debug cycles
during the SDAS launch sprint (2026-07-31, ~17:41–17:56Z).

**How to apply:** In any scheduler wrapper that calls more than one run-with-op-style
script, set `OP_SERVICE_ACCOUNT_TOKEN` (and item overrides like `METAOP_ITEM`) inline on
the single command that needs them, never `export` at script top. For headless Meta
access use the sm_os token + `METAOP_ITEM="sdas-metaads API Credential"` (the field
falls back to `credential`), verified with a read-only getAd before trusting it. Also:
launchd has a bare PATH (no /opt/homebrew/bin) and no desktop 1Password session — never
rely on either. Related: [[meta-ads-run-with-op-is-live-mode]].
