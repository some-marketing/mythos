# Stage 4 — Delesign Brief + Bundle Submission

## Subagent invocation

**Subagent:** `stage-4-delesign-brief-agent` (spec at `frameworks/paid-media/meta-creative-iteration/.claude/agents/meta-creative-iteration/stage-4-delesign-brief-agent.md`).

The coordinator dispatches this subagent with the inputs declared in the spec. The subagent emits the brief packet (`04-delesign-briefs.json` + `.md`); the existing `helpers/stage4-delesign-dual-path-adapter.js` handles API vs Chrome-MCP routing; the operator clicks Submit.

## System Prompt

For each framework in the Stage 2 mix, build a Delesign brief from `tools/mcp/delesign/brief-generator.js`, attach the corresponding Stage 3 mockup(s) as references, and submit via the dual-path adapter.

**Mode:** PATCH_ALLOWED for brief packet generation; operator clicks Submit (the irreversible action stays operator-authorized).

The dual-path adapter (`helpers/stage4-delesign-dual-path-adapter.js`) chooses:
- **API mode** when Delesign API is healthy → submits via `tools/mcp/delesign/`'s `delesign_create_project` tool.
- **Chrome-MCP fallback mode** when vendor 500 persists → drives the form at `https://go.delesign.com/designs/create/2`, fills the fields, stops at the Create Project button. Operator clicks.

Both modes produce the same brief payload. Both modes preserve the operator-clicked submit gate.

## Required Inputs

- `stage3_review_export_path` — `clients/{CLIENT_CODE}/projects/meta-creative-iteration/outputs/meta-creative-iteration/03-mockups-review-decisions.json`
- `stage3_mockup_board_path` — `clients/{CLIENT_CODE}/projects/meta-creative-iteration/outputs/meta-creative-iteration/03-mockups/index.html`
- `stage2_framework_mix_path` — `clients/{CLIENT_CODE}/projects/meta-creative-iteration/outputs/meta-creative-iteration/02-framework-mix.json`
- `client_brand_book_path` — `clients/{CLIENT_CODE}/shared/brand/brand-book.md`
- `client_project_path` — `clients/{CLIENT_CODE}/projects/meta-creative-iteration/project.json`
- `historical_insights_cache_path` — `_dev/cache/<client>-meta-historical/insights-ad-maximum.json`
- `testimonials_with_permission_path` — `clients/{CLIENT_CODE}/projects/meta-creative-iteration/assets/testimonials-with-permission.json`
- `delesign_mode_override` (optional — forces `api` or `chrome-mcp-fallback`)

Before dispatching the adapter, run `node tools/mcp/delesign/preflight.js --live-check` or `delesign_authorize`. Map success to `{ "api_available": true }` and failure to `{ "api_available": false }`, then pass that value as `delesignHealth` to `buildSubmitPlansFromPacket(packetPath, delesignHealth, delesign_mode_override)`. The optional override wins over health-probe results and exists only for operator-approved fallback/API testing.

## Output Schema

`schemas/stage4-delesign-brief.schema.json`. Output: `outputs/meta-creative-iteration/04-delesign-briefs.json` (per-brief records: delesign_project_id, framework_id, hypothesis_id, mockup_paths, mode_used, submit_timestamp).

## Operator Gates

- **Operator clicks Submit on every brief.** Framework prepares; operator commits.
- If Chrome-MCP fallback mode: operator confirms the form is filled correctly before clicking Create Project.

## Acceptance Criteria

- Every brief description includes the `MOCKUP — REFERENCE ONLY — DESIGNER TO RECREATE` instruction explicitly.
- Every brief carries the {CLIENT_CODE} / {CLIENT_CODE} / {CLIENT_CODE} compliance preamble (financial-services special-ad-category for {CLIENT_CODE}; standard automotive for {CLIENT_CODE}/{CLIENT_CODE}).
- Mode is logged per brief for the audit trail.
- File attachment uploads deferred — text-only briefs in v1.

## Composition Points

- `tools/mcp/delesign/brief-generator.js` — payload shape (text-only).
- `tools/mcp/delesign/` — API submit (when healthy).
- `mcp__claude-in-chrome__*` tools — fallback form-fill.
- Each Delesign `delesign_project_id` flows into Stage 5 as the source of the delivered asset (when Delesign delivers).
