# Campaign Management Guardrails — DRAFT Amendment (2026-04-22)

> **STATUS: DRAFT — NOT ACTIVATED.** This file proposes an amendment to `frameworks/paid-media/campaign-management/guardrails.md`. It has no force until activated via the procedure in Section 4.

---

## Section 1: Metadata

- **Date authored**: 2026-04-22
- **Author actor**: Claude agent (coordinator) + Codex (reviewer, pass-1 + pass-2)
- **Parent plan**: `_dev/reports/analysis/task-plans/google-ads-search-build-and-publish-system__plan.md`
- **Status**: `DRAFT — NOT ACTIVATED`
- **Activation conditions (Gate B preconditions — ALL required)**:
  1. Google Ads developer token operator-approved (basic/standard access)
  2. MCC-aware CREATE/UPDATE mutate tools implemented in `tools/mcp/google-ads/` (campaigns, ad groups, keywords, ads, budgets)
  3. Unit tests for each mutate tool green, asserting dry-run-by-default and preview_hash binding
  4. Snapshot tests for dry-run output green
  5. First live smoke run on operator-present scratch campaign executed and verified (readback matches preview)
  6. Operator ratification artifact written per Section 4 step 2
- **Activation ratification artifact path (written at activation time)**: `_dev/research/paid-media-guardrails-amendment-activation-<YYYY-MM-DD>.md`

---

## Section 2: Proposed amendment text

### Lines in current guardrails targeted for replacement

- Line 18: `Ad platform access is manual — the operator executes all platform changes`
- Line 27: `Never auto-submit campaigns, ad groups, ads, or budget changes to any ad platform`
- Line 28: `All platform changes require operator execution — this framework produces plans, not API calls`

Lines 29, 30, 51 remain unchanged; they concern labeling, platform-specific recommendations, and operator-execution checklist items that are not affected by this bounded exception.

### Proposed replacement text

> Ad platform access is operator-gated. The operator executes all platform changes UNLESS the change is performed via an approved preview-approve-push pipeline defined in another framework that (a) composes this framework, (b) renders a preview artifact conforming to the `PreviewBundle/1.0` schema, (c) receives an explicit per-change approval artifact from the operator conforming to the `PreviewApproval/1.0` schema, (d) binds the mutation to the approval via `preview_hash` equality, and (e) performs post-push readback verification.
>
> The only currently-authorized such pipeline is defined in `paid-media/google-ads-search-campaign-build` and operates through the Google Ads MCP CREATE/UPDATE tools at `tools/mcp/google-ads/`. All other platform changes across other advertising platforms (Meta, LinkedIn, TikTok, Microsoft, etc.) remain operator-executed.
>
> This authority may be revoked at any time. Specific revocation conditions:
> - Any preview-approved push produces a materially incorrect or harmful platform state (readback divergence or unintended mutation)
> - Any push bypasses the `preview_hash` binding check
> - Any operator approval artifact is later found to have been generated or influenced by a non-human actor
> - Operator files an explicit revocation artifact at `_dev/research/paid-media-guardrails-amendment-revocation-<timestamp>.md`
>
> Upon revocation, all CREATE/UPDATE mutate tools in `tools/mcp/google-ads/` revert to dry-run-only behavior without activation possibility until a new ratification cycle is completed.

### Replacement rule for checklist line 51

Line 51 (`All campaign changes marked as requiring operator execution`) is amended to: `All campaign changes marked as requiring operator execution OR marked as eligible for preview-approve-push via an authorized pipeline per Section "Platform Execution".`

---

## Section 3: Provenance chain

All artifacts below verified present on disk at draft authorship time (2026-04-22):

- **Grounding reference** (pattern source for psychic-prison / guardrail-amendment protection — grounding-check #7): `_dev/reports/analysis/run-debrief__google-ads-dual-plan-2026-04-22.md`
- **Codex pass-1 architecture review** (verdict: proceed-with-adjustments, 6 adjustments absorbed): `_dev/reports/analysis/codex-last-message__20260422T170450Z__google-ads-search-build-publish-pass1-2026-04-22.md`
- **Codex pass-2 written-artifact review** (verdict: repairs-applied, 4 adjustments absorbed inline): `_dev/reports/analysis/codex-last-message__20260422T171412Z__google-ads-search-build-publish-pass2-2026-04-22.md`
- **Codex pass-2 recheck** (verdict: clean): `_dev/reports/analysis/codex-last-message__20260422T172542Z__google-ads-search-build-publish-pass2-recheck-2026-04-22.md`
- **Operator approval of Plan B**: `_dev/reports/analysis/review-task-plan__20260422T_operator-approval__google-ads-search-build-and-publish-system.md`

---

## Section 4: Activation procedure

Procedural steps for turning this DRAFT amendment into an active guardrails change. This is the work Gate B step B3 will execute.

1. Operator verifies all Gate B preconditions in Section 1 are met (token approved; CREATE/UPDATE tools implemented + unit-tested + dry-run-snapshotted + live-smoke-verified).
2. Operator writes ratification artifact at `_dev/research/paid-media-guardrails-amendment-activation-<YYYY-MM-DD>.md` containing the explicit text: `I, <operator>, ratify the amendment drafted at frameworks/paid-media/campaign-management/guardrails__DRAFT-amendment-2026-04-22.md to become active.`
3. Claude (or operator manually) merges the amendment text from Section 2 into `frameworks/paid-media/campaign-management/guardrails.md` at lines 18, 27, 28, and 51.
4. The draft amendment file is moved/renamed to `frameworks/paid-media/campaign-management/guardrails__amendment-activated-<timestamp>.md` with appended activation metadata block (ratification artifact path, activation timestamp in `+%Y-%m-%dT%H:%M:%S%z`, actor who performed the merge).
5. A coordination signal of type `guardrails-amendment-activated` is written at `_dev/reports/signals/guardrails-amendment-activated__paid-media-campaign-management__<timestamp>.signal.json` for audit trail.
6. All google-ads MCP CREATE/UPDATE mutate tools become eligible to execute live — still subject to the per-call gates: `preview_hash` binding equality, valid `PreviewApproval/1.0` artifact, and post-push readback verification.

---

## Section 5: Falsifiability

Three concrete observations that would falsify the premise of this amendment and trigger revocation per Section 2:

1. A `preview_hash`-approved push produces a platform state that diverges from the approved preview (readback failure, and remediation cannot be performed cleanly without further operator-executed rollback).
2. A bug in the MCP CREATE/UPDATE tools allows a live mutate to fire when `GOOGLE_ADS_DRY_RUN=true` was supposed to be enforced (dry-run bypass).
3. A `PreviewApproval/1.0` artifact is generated without human operator authorship — e.g., written by an agent on the operator's behalf and auto-approved — demonstrating that the approval gate is socially bypassable.

Any one of the above, observed, moves the authority from "granted under this amendment" to "revoked pending new ratification cycle."

---

*End of DRAFT amendment. No changes to the active guardrails file have been made.*
