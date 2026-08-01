# 06 — Measurement and Launch

- Step ID: 06
- Name: measurement-and-launch
- Execution mode: RUN_ONLY (via google-ads MCP preview-approve-push pipeline)

## Goal
Bind conversion measurement, choose attribution, execute the preview-approve-push apply pipeline against the google-ads MCP, and capture a post-push readback. This step is the only mutation step.

## Inputs expected
- Steps 01-05 preview-bundle artifacts.
- Operator approval recorded in the companion signal for this plan.
- google-ads MCP configured with credentials via Subagent Preflight Contract.
- Pipeline spec at `_dev/concepts/google-ads-apply-pipeline-v1.md`.

## Process
1. Conversion-action audit: confirm primary conversion actions from step 01. Add/confirm micro-conversions where they derisk the main goal signal (form-start, engaged-scroll, qualified-call-duration).
2. Enhanced Conversions: confirm first-party data hashing setup on the landing pages and that user_data fields flow through. Block launch if not verified when the offer relies on it.
3. Call tracking: if call asset is used, bind Google forwarding numbers and a minimum-call-duration conversion; confirm the call-conversion action is in step 01's inventory.
4. Attribution model: choose from Data-Driven (default when eligible), Last Click (fallback when volume is insufficient). Justify in the artifact.
5. Assemble the full preview bundle (campaigns, ad groups, keywords, negatives, RSAs, assets, settings). Compute preview_hash. Record the hash in the companion signal.
6. Operator approval checkpoint: the signal must record explicit approval with the preview_hash attached. No approval, no push.
7. Push via the apply pipeline. Capture the MCP response, any mutation errors, and the resulting resource names.
8. Post-push readback: GAQL read the pushed entities, diff against the preview bundle, record mismatches. Readback artifact is required.
9. Launch checklist: impressions flowing within 2 hours, conversion tracking firing on a test event, no disapprovals, no policy holds.

## Output artifact
`outputs/google-ads-search-campaign-build/06_measurement-and-launch/` (directory): `measurement-plan.md`, `preview-bundle.json` (with preview_hash), `push-response.json`, `readback.md`, `launch-checklist.md`.

## Gates before advancing (closing this framework run)
- Measurement gate: conversion actions bound, enhanced conversions addressed, call tracking addressed if in scope, attribution model chosen with rationale.
- Launch gate: preview_hash bound, operator-approval record linked, push executed, readback artifact captured with any mismatches surfaced.

## Distilled principles

**Measurement is upstream of every optimization decision.** An account that can't measure the thing it wants more of cannot be optimized toward it — only toward proxies.
- Evidence basis: Ed Leake, Foundations/Call Conversion Tracking + Foundations/Enhanced Conversions + Foundations/Micro Conversions + KnowledgeBase/1_Measurement. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: new sites with no history — measurement may need a 2-4 week baseline before bid-strategy decisions from step 03 are trusted. The plan can launch on Manual CPC and graduate later.

**Attribution model is a deliberate choice, not a default.** Data-Driven is often correct but requires eligibility (conversion volume); Last Click is the honest fallback when volume is thin.
- Evidence basis: Ed Leake, Attribution/Picking the Right Attribution Model. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: cross-device journeys that Google can't stitch — DDA underweights unobservable touches, and the plan should note this rather than treat DDA as ground truth.

**Readback is the only proof.** Pre-push preview is a promise; post-push GAQL read is the evidence. A framework run without a readback has not launched — it has guessed.
- Evidence basis: Mythos repo convention (mandatory verification; post-push readback in promotion criteria); no Ed Leake equivalent. (ratified 2026-06-08 — see `frameworks/_shared/reference/google-ads-account-review-2025-2026.md`)
- Failure conditions: none — this principle is policy for this framework, not a heuristic.
