# First-Run Checklist

Use this checklist on the first execution of `paid-media/meta-creative-iteration` against any new client.

## Pre-flight (one-time per client)

- [ ] `clients/<CLIENT>/projects/meta-app-integration/project.json` exists with `meta_integration.ad_account_id` populated.
- [ ] `meta_integration.compliance_posture.expected_conversion_event` is set to the exact event name configured in Meta Ads Manager.
- [ ] `meta_integration.compliance_posture.meta_special_ad_category` is correct (`credit` for financing-led ads; `none` for standard automotive; check rules at https://www.facebook.com/business/help/298000447747885).
- [ ] Token resolves: `METAOP_ITEM="..." METAOP_VAULT="..." METAOP_FIELD_TOKEN="..." META_AD_ACCOUNT_ID="<ad_account_id>" tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/preflight.js --live-check` returns `live_check.ok: true`.
- [ ] Big Book cache is fresh (≤7 days old): `_dev/cache/notion/big-book-of-static-ad-frameworks.json` exists and `parsed_at` is recent.

## Stage 0 (every iteration)

- [ ] Pull recent `meta_export_insights` for the past 7 days.
- [ ] Pass it to `helpers/stage0-conversion-signal-validator.js`.
- [ ] Verdict is `pass` — or operator confirms `needs-operator-confirmation`.
- [ ] If `block`: STOP. Fix pixel/CAPI installation before any creative work.

## Stage 1 → 4 (creative authoring)

- [ ] AI proposed ≥3 hypotheses; operator picked one.
- [ ] Stage 2 framework mix passed the model-visible diversity audit (≥3 distinct dimensions).
- [ ] Stage 3 mockups carry the watermark `MOCKUP — REFERENCE ONLY — DESIGNER TO RECREATE`.
- [ ] Stage 4 brief description includes "Use mockup as reference for layout/feel only. Do not trace."
- [ ] Stage 4 brief description includes the client's compliance preamble (financial-services special-ad for {CLIENT_CODE}; automotive standard for {CLIENT_CODE}/{CLIENT_CODE}).
- [ ] Operator clicked Create Project for each brief.

## Stage 5 (Meta push)

- [ ] `tools/mcp/meta-ads/compliance-preflight.js` returned `decision: 'allow'` for every payload.
- [ ] `compliance.special_ad_category_acknowledged=true` for {CLIENT_CODE}; not required for {CLIENT_CODE}/{CLIENT_CODE} unless campaign leads with financing.
- [ ] `compliance.ai_generated_or_altered=false` for Delesign-produced visuals (operator verified Delesign did not use AI image generation in their pipeline for this deliverable).
- [ ] For click-to-call creatives, live working creative's `asset_feed_spec.call_ads_configuration` was read and cloned when repointing.
- [ ] After write, Meta readback confirmed `degrees_of_freedom_spec` persisted when flexible creative / dynamic optimization fields were in scope.
- [ ] Each ad name encodes `framework_id` (e.g., `{CLIENT_CODE}-2026-05-before-and-after-msg42`).
- [ ] Operator approved the payload before push.

## Stage 5a (pre-registration)

- [ ] All six required fields filled and non-null.
- [ ] Primary metric matches Stage 1 falsification criteria.
- [ ] Sample-size minimum is ≥30 conversions per cell (or override reason recorded).
- [ ] Operator approved the pre-registration; `locked: true`.
- [ ] File `05a-preregistration.json` exists before any Stage 6 invocation.

## Stage 6 (readout)

- [ ] `helpers/stage6-readout-helper.js::loadAndValidatePreregistration` returned valid.
- [ ] No cell returned `decide` based on insufficient sample size.
- [ ] No cell returned `decide` while attribution window was open.
- [ ] Output records the modeled-reporting caveat.

## Stage 7 (refresh evaluation)

- [ ] Saturation vs. exhaustion is named explicitly per cell (not collapsed into "ad is tired").
- [ ] Next-iteration `prior_iteration_artifact` path is recorded.
- [ ] Operator approved the next-iteration plan before any new cycle fires.
