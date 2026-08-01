# improve__20260610__tool-promotion.md

**Framework:** paid-media/meta-creative-iteration  
**Date:** 2026-06-10  
**Type:** /improve-framework — tool-promotion pass  
**Executed by:** Claude (claude-sonnet-4-6), worker actor

## Governing Inputs

| Artifact | Path |
|---|---|
| Codex proposal | `_dev/reports/analysis/codex-last-message__20260610T144137Z__meta-ads-tools-promotion-meta-creative-iteration.md` |
| Operator decision | `_dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md` |
| Convene synthesis (8 named changes) | `_dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md` |

## The 8 Named Changes Applied

1. **client.js pre-condition fix** — `createAdCreativeFlexible` now accepts and passes `instagram_user_id` (object_story_spec) and `contextual_multi_ads`. Root cause of {CLIENT_CODE} raw-graphPost bypasses (Meta error 1772103). Backward compatible.

2. **Rename placement-video-ad-builder to placement-ad-builder** — mandatory `creative_type: 'image'|'video'` parameter. {CLIENT_CODE} June 48-static-image bundle is the first consumer. Image path: `asset_feed_spec.images` + `image_label` customization rules, no video liveness loops. Video path: {CLIENT_CODE} PLACEMENT behavior preserved.

3. **Parameterize complianceCheck** — `copy-compliance-gate.js` has no {CLIENT_CODE}-specific copy-block defaults (`COPY_26`/`COPY_17`). Caller supplies copy-block config explicitly. `bannedPatterns`, `superlativeTokens`, char limits, and `maxOptionsPerField` are all config params with safe automotive defaults.

4. **protected_ad_ids as first-class config key** — `activate-ads.js` accepts `protected_ad_ids` as a named config key in the activation config JSON. Never-touch fence pattern (CATALOG_AD_ID from restructure-ss-video-ads.js:54) is now reusable.

5. **Batch-manifest input schema** — `placement-ad-builder.js` accepts a `manifest.json` with `ads: [N]` for N-ad bundles. {CLIENT_CODE} June = 48 statics. Preview/build-plan mode works with zero network.

6. **Activation stays a distinct gated tool** — `activate-ads.js` is NOT folded into the builder (named disagreement preserved: Gemini argued composite; alpha+codex sided for separate gate). Distinct tool = canary/rest/activation progression is enforced at the tool boundary.

7. **Readback verifier format-agnostic** — `readback-verifier.js` handles both `image` and `video` PLACEMENT creatives. Image path checks `asset_feed_spec.images`; video path checks `asset_feed_spec.videos`. Format-agnostic rule checks, CTA, link, url_tags, DOF.

8. **{CLIENT_CODE} scripts preserved as receipts** — superseded headers added to `recon-used-adset.js`, `restructure-ss-video-ads.js`, `activate-ss-video-ads.js` (apply-multivariant-copy.js already had one). Runtime behavior UNCHANGED. Not to be deleted until shared tools pass one {CLIENT_CODE} live run.

## Files Created

| File | Purpose |
|---|---|
| `tools/mcp/meta-ads/copy-compliance-gate.js` | Parameterized copy compliance gate (CLI + module) |
| `tools/mcp/meta-ads/distill-adset-build-spec.js` | GET-only ad-set recon distiller (CLI + module) |
| `tools/mcp/meta-ads/placement-ad-builder.js` | Placement-customized creative builder, image+video (CLI + module) |
| `tools/mcp/meta-ads/readback-verifier.js` | Format-agnostic PLACEMENT creative readback verifier (CLI + module) |
| `tools/mcp/meta-ads/activate-ads.js` | Explicit-allowlist activation gate (CLI + module) |
| `tools/mcp/meta-ads/__tests__/copy-compliance-gate.test.js` | Unit tests: compliance gate (fixture + parameterization) |
| `tools/mcp/meta-ads/__tests__/distill-adset-build-spec.test.js` | Unit tests: spec distiller (fixture + unit) |
| `tools/mcp/meta-ads/__tests__/placement-ad-builder.test.js` | Unit tests: builder — image fixture, video fixture, DOF laws, validation |
| `tools/mcp/meta-ads/__tests__/readback-verifier.test.js` | Unit tests: readback verifier — image path, video path, format-agnostic checks |
| `tools/mcp/meta-ads/__tests__/create-ad-creative-flexible.test.js` | Unit tests: client.js instagram_user_id + contextual_multi_ads passthrough |
| `tools/mcp/meta-ads/__fixtures__/copy-compliance/passing-automotive.json` | Compliance fixture: passing |
| `tools/mcp/meta-ads/__fixtures__/copy-compliance/failing-em-dash.json` | Compliance fixture: em-dash violation |
| `tools/mcp/meta-ads/__fixtures__/copy-compliance/failing-agency-named.json` | Compliance fixture: agency-named violation |
| `tools/mcp/meta-ads/__fixtures__/copy-compliance/failing-superlative-budget.json` | Compliance fixture: superlative budget exceeded |
| `tools/mcp/meta-ads/__fixtures__/readback/placement-video-pass.json` | Readback fixture: video PLACEMENT passing |
| `tools/mcp/meta-ads/__fixtures__/readback/placement-image-pass.json` | Readback fixture: image PLACEMENT passing |
| `tools/mcp/meta-ads/__fixtures__/readback/readback-fail-status.json` | Readback fixture: status mismatch failure |
| `tools/mcp/meta-ads/__fixtures__/dry-run-output/adset-recon-used.json` | Recon fixture from {CLIENT_CODE} live recon (trimmed) |
| `tools/mcp/meta-ads/__fixtures__/dry-run-output/example-image-manifest.json` | Example static image batch manifest fixture |
| `tools/mcp/meta-ads/__fixtures__/dry-run-output/example-video-manifest.json` | Example video batch manifest fixture |

## Files Changed

| File | Change |
|---|---|
| `tools/mcp/meta-ads/client.js` | `createAdCreativeFlexible`: added `instagramUserId` + `contextualMultiAds` params |
| `frameworks/paid-media/meta-creative-iteration/manifest.json` | Version 0.1.0 → 0.2.0; `mcp_requirements.meta-ads.tools` array added; `stage_5_compliance_preflight` updated; `stage_5_placement_build` gate added |
| `clients/{CLIENT_CODE}/projects/may-2026-offers/recon-used-adset.js` | Superseded header added |
| `clients/{CLIENT_CODE}/projects/may-2026-offers/restructure-ss-video-ads.js` | Superseded header added |
| `clients/{CLIENT_CODE}/projects/may-2026-offers/activate-ss-video-ads.js` | Superseded header added |

## Test Evidence

Command: `node --test tools/mcp/meta-ads/__tests__/copy-compliance-gate.test.js tools/mcp/meta-ads/__tests__/distill-adset-build-spec.test.js tools/mcp/meta-ads/__tests__/placement-ad-builder.test.js tools/mcp/meta-ads/__tests__/readback-verifier.test.js tools/mcp/meta-ads/__tests__/create-ad-creative-flexible.test.js`

Result: **64 pass / 0 fail / 0 skip** — duration ~95ms, zero live API calls.

Test coverage:
- copy-compliance-gate: 10 tests (pass fixture, 3 fail fixtures, 5 parameterization cases, DEFAULT_CONFIG export)
- create-ad-creative-flexible: 6 tests (instagram_user_id pass/omit, contextual_multi_ads pass/omit, DOF passthrough, backward compat)
- distill-adset-build-spec: 8 tests (fixture mode, all-adsets, unknown ID error, IG detection, unit cases for empty/catalog/PLACEMENT)
- placement-ad-builder: 24 tests (image fixture 10 cases incl. law tests + batch, video fixture 5 cases, DOF laws 4 cases, validation 3 cases)
- readback-verifier: 16 tests (video pass, image pass, fail-status, 13 format-agnostic mismatch detections)

## Live-Learned Laws Encoded

All four laws encoded in `placement-ad-builder.js` and tested:
- **1772103**: `instagram_user_id` required when IG positions present — validated at manifest validation time
- **1885878**: max ONE `descriptions[]` asset on PLACEMENT creatives — validated at manifest validation time  
- **3858504**: never `standard_enhancements` with `advantage_plus_creative` umbrella — SAFE_DOF/SAFE_DOF_VIDEO have no `standard_enhancements` key (asserted in tests)
- **2061044**: OPT_OUT umbrella + enumerated member opt-ins — SAFE_DOF defaults to `advantage_plus_creative: OPT_OUT` (asserted in tests)

## Deletion Gate

{CLIENT_CODE} scripts may not be deleted until `placement-ad-builder.js`, `activate-ads.js`, and `copy-compliance-gate.js` have collectively passed at least one {CLIENT_CODE} live run ({CLIENT_CODE} June 2026 48-static bundle is the designated first consumer).
