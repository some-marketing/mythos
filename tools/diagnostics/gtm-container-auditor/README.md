# gtm-container-auditor

Captures a structured snapshot of a Google Tag Manager container — triggers, tags, variables, and per-trigger event-name match details — without an interactive login flow.

**Reuses operator's authenticated Chrome session.** No `record-auth` step. Three attach modes ranked by preference:

1. **CDP** — attach to the operator's running Chrome via `--remote-debugging-port=9222`.
2. **MCP-eval emission** — emit JS payloads that a claude-in-chrome MCP session can run against the operator's already-loaded GTM tab. Zero new browser launches; reuses the live session.
3. **storageState** — recorded Google login (last resort; needs a one-time interactive recording).

## Usage

### Mode 1 — CDP attach (recommended for headless / scheduled runs)

```bash
# Operator launches Chrome once with debug port
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Sign into Google + open the GTM container.

# Then from anywhere:
node tools/diagnostics/gtm-container-auditor/cli.js \
  --url 'https://tagmanager.google.com/#/container/accounts/<A>/containers/<C>/workspaces/<W>' \
  --cdp http://localhost:9222 \
  --trigger-detail "dle - t1" \
  --trigger-detail "dle - mql0"
```

### Mode 2 — MCP eval (used during live agent sessions)

When the agent already has GTM open via claude-in-chrome MCP and just needs the readers:

```bash
node tools/diagnostics/gtm-container-auditor/cli.js \
  --url '<gtm-url>' \
  --emit-mcp-payloads \
  --trigger-detail "dle - t1"
```

Outputs a JSON array of `{ label, hash, js }` steps. The agent navigates to each `hash` via the MCP, runs the `js` payload via `javascript_tool`, and aggregates the results.

### Mode 3 — storageState (fallback)

```bash
# One-time interactive recording (see tag-assistant-driver/record-auth.js pattern)
# Then:
node tools/diagnostics/gtm-container-auditor/cli.js \
  --url '<gtm-url>' \
  --storage-state ~/.Mythos/auth/tagmanager.storage.json
```

## Output

`_dev/reports/gtm-audits/<stamp>__gtm-<container>-ws<workspace>.json` — structured snapshot:

```json
{
  "capturedAt": "...",
  "ids": { "account": "...", "container": "...", "workspace": "..." },
  "triggers": { "rowCount": N, "rows": [...] },
  "tags":     { "rowCount": N, "rows": [...] },
  "variables":{ "rowCount": N, "rows": [...] },
  "triggerDetails": [{ "rowPrefix": "dle - t1", "eventNameInputs": [...], "selectedRadios": [...] }]
}
```

## Provenance

Validated against {CLIENT_CODE} container `{GTM_CONTAINER_ID}` (2026-05-27). Captured the full trigger/tag map and confirmed the `dle - t<N>` triggers match dataLayer event `lead_submit_T<N>` exactly. Output drove `clients/{CLIENT_CODE}/projects/google-ads-tracking-diagnostic/findings/gtm-container-audit.md`.

## Fragility

GTM's Angular Material markup changes regularly. The readers use generic row/cell selectors and tolerate small reshuffles, but if the structure changes meaningfully:
1. Run with `--emit-mcp-payloads` to get the raw JS.
2. Inspect via DevTools to find new selectors.
3. Update `lib/readers.js` and commit.
