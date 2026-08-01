# Stage 5 — Push to Meta, Tagged by Framework

## Subagent status

no subagent in Phase 2 — coordinator-only (sensitive write surface; coordinator drafts the payload at `state=draft` per `stage5-meta-push-payload.schema.json`, runs compliance preflight, presents to operator for approval, then coordinator commits the irreversible push at `state=applied`). A Stage 5 drafting subagent may be introduced in a future iteration; for Phase 2, all Stage 5 draft authoring is coordinator-driven.

## System Prompt

After Delesign delivers + operator approves the deliverable (gate G3 in the underlying plan), construct the Meta payload via the existing Meta MCP, run compliance preflight, present to operator for approval, then push.

**Mode:** REVIEW_ONLY for payload drafting; PATCH_ALLOWED for the operator-approved Meta MCP write.

Every ad pushed carries its `framework_id` in two places:
1. **The local store** (`outputs/meta-creative-iteration/05-meta-push-payloads.json`) — keyed by Meta `ad_id` for Stage 6 attribution.
2. **The Meta ad name** (e.g., `{CLIENT_CODE}-2026-05-before-and-after-msg42`) — for human navigability in Ads Manager.

## Required Inputs

- Stage 4 Delesign delivered assets (operator-approved)
- `client_project_path` (provides `ad_account_id` and `compliance_posture`)
- Stage 1 hypothesis id and Stage 2 framework_id

## Output Schema

The push payload artifact conforms to `../schemas/stage5-meta-push-payload.schema.json` (relative to this prompt: `frameworks/paid-media/meta-creative-iteration/schemas/stage5-meta-push-payload.schema.json`). The schema defines an explicit `state` field (`draft` | `approved` | `applied` | `rejected`) so the artifact carries its lifecycle in-band instead of inheriting it from a transcript. Validate every write against the schema.

Output: `outputs/meta-creative-iteration/05-meta-push-payloads.json` (one record per ad pushed, with Meta ad_id, framework_id, hypothesis_id, compliance_verdict, push_timestamp). The applied record is the same artifact at `state=applied` with `apply_result.ad_ids_created` populated.

## State Transitions

The artifact moves through a small state machine. Each transition appends to `state_transitions` with `{from, to, timestamp, actor, evidence}`.

- `null → draft` — Coordinator drafts the payload (variants + compliance_preflight_result). MUST NOT include `operator_approval` or `apply_result`. Actor: coordinator (main-thread Claude). A future iteration may delegate this step to a Stage 5 drafting subagent; in Phase 2 there is no such subagent.
- `draft → approved` — Operator approves the drafted payload. `operator_approval` is populated. Actor: human operator (recorded in `approved_by`).
- `draft → rejected` or `approved → rejected` — Operator declines; `operator_approval.override_reason` is required. No Meta write occurs. Actor: human operator.
- `approved → applied` — Coordinator calls the Meta MCP write surface and records `apply_result` with the Meta-returned ad ids. Actor: coordinator (main-thread Claude after operator gate clears).

This separation is the contract: only the operator authorizes the move to `approved`/`rejected`; only the coordinator performs `applied`. A payload at `applied` without a populated `operator_approval` is a contract violation. If a future iteration adds a drafting subagent, it MUST NOT transition past `draft`.

## Operator Gates

- **Compliance preflight runs before any push.** A `block` verdict from `tools/mcp/meta-ads/compliance-preflight.js` halts the push. Override possible only with explicit recorded reason; failures remain in the audit verdict.
- **Operator approves the payload** before any Meta MCP write-capable command runs.

## Meta API Readback Requirements

After every Meta creative write or creative repoint, read the live creative/ad
record back from Meta before moving the Stage 5 artifact to `state=applied`.
Record the readback evidence path and comparison result in `apply_result`.

Required checks:
- For click-to-call creatives, compare the intended payload against the live
  working creative's `asset_feed_spec.call_ads_configuration`. If Meta returns
  `2061044 Invalid Phone Number`, first hypothesis is missing or mismatched call
  configuration, not necessarily a malformed phone literal.
- For flexible creative / dynamic optimization fields, verify
  `degrees_of_freedom_spec` persisted exactly as intended. If a helper path drops
  those fields, retry through a lower-level write path and read back again.

## Acceptance Criteria

- `compliance.special_ad_category_acknowledged=true` for {CLIENT_CODE} (Credit category).
- `compliance.ai_generated_or_altered=false` for Delesign-produced visuals (override only if Delesign uses AI image generation in their pipeline for that deliverable; operator verifies per project).
- `framework_id` recorded in both local store and ad name.
- No new Meta write surface introduced — composes with existing `tools/mcp/meta-ads/`.
- Meta readback confirms click-to-call call configuration and `degrees_of_freedom_spec` persistence when those fields are in scope.

## Composition Points

- `tools/mcp/meta-ads/` — Marketing API write surface.
- `tools/mcp/meta-ads/compliance-preflight.js` — gates every push.
- `clients/<CLIENT>/projects/meta-app-integration/project.json` — provides `ad_account_id`, compliance posture.
