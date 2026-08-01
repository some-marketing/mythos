# Meta Creative Iteration — Operator Runbook

## What this framework does

Runs one iteration cycle of algorithm-aware Meta ad creative against a specific client project. Reads the client's Meta posture from `clients/<CLIENT>/projects/meta-app-integration/project.json`, runs nine stage prompts (0 through 7, plus Stage 5a), and produces a structured iteration bundle.

**Doctrine anchor:** `_dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md`. Read it before running the framework against a new client.

## Per-client routing

Every execution targets a client by passing `client_project_path`. The framework knows nothing client-specific by itself.

| Client | project.json |
|---|---|
| {CLIENT_CODE} | `clients/{CLIENT_CODE}/projects/meta-app-integration/project.json` |
| {CLIENT_CODE} | `clients/{CLIENT_CODE}/projects/meta-app-integration/project.json` |
| {CLIENT_CODE} | `clients/{CLIENT_CODE}/projects/meta-app-integration/project.json` |

Compliance posture, ad account ID, and Meta App credential resolution flow from these files. Adding a new client means adding a new project.json — no framework code changes.

## Input contract (recap)

Required:
- `client_project_path`
- `campaign_goal`

Optional:
- `prior_iteration_artifact` — path to a previous iteration bundle (feeds Stage 1 + Stage 7 context)
- `budget_window` — daily/weekly/monthly budget the iteration is sized against (informs Stage 5a sample-size minimums)
- `delesign_mode_override` — `api` or `chrome-mcp-fallback`. Default is auto-detect.

## Stage walkthrough

The stages are read-only by default (FINDINGS_ONLY / REVIEW_ONLY); only Stage 4 (operator clicks Submit) and Stage 5 (operator clicks Push) commit irreversible actions.

| Stage | Mode | Output | Operator gate |
|---|---|---|---|
| 0 — signal sanity | FINDINGS_ONLY | `00-conversion-signal-sanity.json` | confirm if `needs-operator-confirmation` |
| 1 — message hypothesis | REVIEW_ONLY | `01-message-hypothesis.json` | pick one of ≥3 |
| 2 — framework mix | REVIEW_ONLY | `02-framework-mix.json` | approve mix after audit pass |
| 3 — mockups | REVIEW_ONLY | `03-mockups/` | implicit (reviewed at Stage 4) |
| 4 — Delesign brief | REVIEW_ONLY then operator click | `04-delesign-briefs.json` (subagent-emitted) | click Create Project (per brief) |
| 5 — Meta push | REVIEW_ONLY then PATCH_ALLOWED | `05-meta-push-payloads.json` (coordinator-drafted in Phase 2) | approve payload before push |
| 5a — pre-registration | REVIEW_ONLY | `05a-preregistration.json` | approve to lock |
| 6 — readout | FINDINGS_ONLY | `06-readout.json` (helper) + `06-readout-narrative.json` (subagent narrative companion) | none internal |
| 7 — refresh trigger | REVIEW_ONLY | `07-refresh-decisions.json` | approve next iteration |

## Stage 4 composition (Phase 2)

Stage 4 composes a subagent + helper + operator click:

1. The `stage-4-delesign-brief-agent` (spec at `frameworks/paid-media/meta-creative-iteration/.claude/agents/meta-creative-iteration/stage-4-delesign-brief-agent.md`) authors the brief packet — `04-delesign-briefs.json` (validates against `schemas/stage4-delesign-brief.schema.json`) plus a paste-ready `04-delesign-briefs.md`. The agent does NOT submit the form and does NOT route API vs Chrome-MCP fallback.
2. `helpers/stage4-delesign-dual-path-adapter.js` consumes the packet and routes API mode (when Delesign API is healthy) vs Chrome-MCP fallback mode (while vendor 500 persists).
3. The operator clicks Submit (Chrome-MCP fallback) or confirms the API submit. The irreversible action stays operator-authorized.

## Stage 4 fallback path (Delesign API down)

While the Delesign API returns HTTP 500 on every endpoint (open support ticket), Stage 4 uses the Chrome-MCP fallback path inside the dual-path adapter:

1. Adapter navigates an MCP tab to `https://go.delesign.com/designs/create`.
2. Clicks `Social Media Posts and Ads` subcategory.
3. Fills Project Title, Target Audience, File size or dimension, Description, Inspiration from the subagent-authored brief packet.
4. Stops at Create Project — **operator clicks**.

When Delesign restores the API, set `delesign_mode_override=api` to switch back, or remove the override to let the adapter auto-detect.

Reference: `clients/{CLIENT_CODE}/projects/delesign-integration/delesign-support-ticket.txt` for the open vendor issue.

## Stage 6 composition (Phase 2)

Stage 6 splits classification authority from narrative authoring:

1. `helpers/stage6-readout-helper.js` retains classification authority. It produces `06-readout.json` (validates against `schemas/stage6-readout.schema.json`) with the per-cell verdict (`decide` / `monitor` / `do_not_decide_yet`) measured against the locked Stage 5a pre-registration.
2. The `stage-6-insights-readout-agent` (spec at `frameworks/paid-media/meta-creative-iteration/.claude/agents/meta-creative-iteration/stage-6-insights-readout-agent.md`) reads the helper output and authors the narrative COMPANION artifact `06-readout-narrative.json` (validates against `schemas/stage6-readout-narrative.schema.json`) plus a paired `.md`. The agent does NOT classify and does NOT mutate `06-readout.json`. The modeled-reporting caveat is mandatory in every narrative.

## Stage 5 compliance preflight

Every Stage 5 push fires `tools/mcp/meta-ads/compliance-preflight.js` before any Meta MCP write. The preflight checks:

- Client resolution by `ad_account_id`
- AI disclosure (false for Delesign-produced visuals — humans designed)
- Special ad category acknowledgement (Credit for {CLIENT_CODE}; standard for {CLIENT_CODE}/{CLIENT_CODE})
- No synthetic testimonials
- No fabricated endorsements
- No protected-class targeting / proxies

A `block` verdict halts the push. Override possible only with explicit recorded reason; failures remain in the audit verdict.

### Stage 5 Meta API readback checks

Before treating a Meta push or creative repoint as applied, read back the live ad
creative fields that Meta persisted. Two observed Marketing API failure patterns
are now part of the framework preflight:

- Click-to-call creatives may return `2061044 Invalid Phone Number` when the new
  creative omits the live working creative's `asset_feed_spec.call_ads_configuration`.
  First inspect the existing working creative and clone the call configuration
  before retrying.
- Dynamic optimization / flexible creative settings can be dropped by helper
  layers. After a write, read back `degrees_of_freedom_spec` and compare it to
  the intended payload before marking the push applied.

Record the readback path and comparison result in the Stage 5 artifact. A write
response alone is not enough evidence for applied-state closure.

## Refreshing the Big Book (Stage 2 input)

The framework registry consulted at Stage 2 is the cached parse of Some Marketing's *Big Book of Static Ad Frameworks* (Notion).

Refresh procedure:
1. In a Claude session: call `mcp__claude_ai_Notion__notion-fetch` on your workspace's static-ad-frameworks reference page (e.g. `https://www.notion.so/<workspace>/<your-ad-frameworks-page>`).
2. Save the `.text` field to `_dev/cache/notion/big-book-of-static-ad-frameworks.raw.md`.
3. Run `node tools/notion/parse-ad-frameworks.js` to regenerate the JSON cache.

Cache is gitignored; refresh weekly or whenever the source page is updated.

## Future enhancements (NOT in v1)

Listed for transparency, do not implement without a new `/plan-task`:
- Holdout/control logic for Stage 7 winner-loser recycling.
- Multimodal metadata provisioning (alt-text, OCR-friendly text overlays).
- Drift review for platform updates / seasonality.
- Cross-platform extension (Google, TikTok, etc.).
- Auto-launching campaigns without operator approval.
- File attachment uploads to Delesign briefs (text-only in v1).
