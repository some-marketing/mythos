# Meta Creative Iteration Guardrails

Framework-specific execution constraints. Extends system guardrails at `.claude/guardrails.md` and the existing `frameworks/paid-media/campaign-management/guardrails.md`.

Anchored to:
- Concept: `_dev/concepts/algo-aware-meta-creative-iteration-framework/concept.md`
- Convene record: `_dev/reports/analysis/convene-runs/20260501T160738Z-algo-aware-meta-creative-iteration/synthesis.md`
- Memory rule: `feedback_algo_aware_meta_creative_iteration`

---

## Execution Modes Used

- **FINDINGS_ONLY**: Stage 0 (signal sanity), Stage 6 (insights readout), Stage 7 (refresh trigger evaluation). Read-only.
- **REVIEW_ONLY**: Stage 1 (message hypothesis), Stage 2 (framework mix proposal), Stage 3 (mockup generation), Stage 4 (brief drafting). Operator approves before forward motion.
- **PATCH_ALLOWED**: Stage 5 (Meta push) and Stage 4 submit are operator-clicked, not framework-automated. The framework prepares; the operator commits.

---

## Stage Guardrails

### Stage 0 — Conversion-signal sanity

- **Blocks forward motion** unless validated. The most-skipped step in agency Meta workflows is signal sanity; the framework refuses to advance past it.
- **Evidence accepted:** (a) `meta_export_insights` shows conversion events firing in the past 7 days at the event named in the client project compliance posture; OR (b) operator-provided screenshot/log of pixel/CAPI test events landing.
- **Failure mode:** if signal is broken, the framework refuses to author a brief — broken signal makes GEM unable to learn from any creative, regardless of quality.

### Stage 1 — Message hypothesis

- Output must include: hypothesis statement, **falsification criteria** (what would prove this wrong), and **landing-page/funnel congruence check** (is the destination experience aligned with the message?).
- Bad post-click experience poisons signal upstream; if congruence fails, fix the destination first.
- AI proposes ≥3 candidate hypotheses; operator picks one before Stage 2 fires.

### Stage 2 — Framework mix selection + model-visible diversity audit

- Mix size: 3–5 frameworks from the 14 in the Big Book.
- **Model-visible diversity audit is a hard gate.** Mix must demonstrate ≥3 materially distinct dimensions among:
  1. Offer angle
  2. Proof type
  3. Format
  4. Visual composition
  5. Landing intent
  6. Funnel stage
- Five frameworks all selling the same offer in the same funnel stage with the same proof type can collapse into one model neighborhood — **that is one test, not five**.
- The Big Book taxonomy is operator-visible; what GEM/Andromeda actually consume is model-visible. The Big Book is a proxy, not a guaranteed source of model-visible diversity.

### Stage 3 — Mockup generation

- Mockups are **internal reference for the Delesign designer**, not the final ad.
- Watermark mandatory: `MOCKUP — REFERENCE ONLY — DESIGNER TO RECREATE`.
- Brief description must include: *"Use mockup as reference for layout/feel only. Do not trace. Final asset must be original human-designed work per the framework."*
- Source mix is per-iteration discretion (operator decision 2026-05-01) — AI image, stock + overlay, or any combination. The watermark + do-not-trace instruction is the load-bearing safety, not the source of pixels.

### Stage 4 — Delesign brief + bundle

- **Composition (Phase 2):** the `stage-4-delesign-brief-agent` authors the brief packet (`04-delesign-briefs.json` + `.md`, validating against `schemas/stage4-delesign-brief.schema.json`); `helpers/stage4-delesign-dual-path-adapter.js` routes API vs Chrome-MCP fallback; the operator clicks Submit. The agent never submits and never routes; the helper never authors.
- **Dual-path adapter required.** API mode when Delesign MCP is healthy; Chrome-MCP fallback (form-fill at https://go.delesign.com/designs/create/2) when vendor 500 persists.
- Both modes consume the identical schema-validated brief payload the subagent emits.
- **Operator clicks Submit.** Never automated. Framework prepares the form; operator commits the irreversible action.
- File attachment uploads deferred — text-only briefs in v1.

### Stage 5 — Meta push tagged by framework_id

- **Compliance preflight is non-negotiable.** Every push fires `tools/mcp/meta-ads/compliance-preflight.js` (special-ad/AI-disclosure gate) and `tools/mcp/meta-ads/copy-compliance-gate.js` (text-field gate — caller supplies the copy-block config explicitly; the shared module carries no client defaults).
- Compliance posture flows from `clients/<CLIENT>/projects/meta-app-integration/project.json` (already populated for {CLIENT_CODE} Credit, {CLIENT_CODE}/{CLIENT_CODE} standard automotive).
- `framework_id` is included in both: (a) the local store record, (b) the Meta ad name (e.g. `{CLIENT_CODE}-2026-05-before-and-after-msg42`).
- **Operator approves the payload** before any push-capable command runs.
- **Build and activate are two separate gates, never one tool.** Placement-customized creative builds go through `tools/mcp/meta-ads/placement-ad-builder.js` (mandatory `creative_type` of `image` or `video`; batch-manifest input for N-ad bundles). Its build-plan/preview mode is **zero-network** — the operator reviews the full payloads before anything touches the live account. Live creation produces PAUSED ads only.
- **Activation is a distinct live-mutation gate:** `tools/mcp/meta-ads/activate-ads.js`. It refuses to run without explicit ad IDs (no-args = list-only), accepts only IDs on its explicit allowlist, and hard-stops on any ID in `protected_ad_ids` — the never-touch fence (CATALOG_AD_ID pattern). Activation is never folded into the builder; that boundary is a safety primitive, not over-engineering.
- **DOF law (live-learned):** never list `standard_enhancements` alongside the `advantage_plus_creative` umbrella (error 3858504), and prefer umbrella `OPT_OUT` + enumerated member opt-ins — a bare `OPT_IN` umbrella caused activation error 2061044. The builder's `SAFE_DOF` defaults encode this; overrides require explicit caller config.

### Stage 5a — Pre-registration

- **Hard gate before Stage 6.** Stage 6 readout refuses to fire without a valid Stage 5a artifact.
- Required fields (all non-optional):
  1. Primary metric
  2. Attribution window
  3. Conversion event
  4. Sample-size minimum
  5. Learning-phase handling
  6. Stopping rules
- Without Stage 5a, all Stage 6 readouts are post-hoc. Post-hoc decisions are not decisions.

### Stage 6 — Insights readout

- **Composition (Phase 2):** classification authority stays with `helpers/stage6-readout-helper.js`, which writes `06-readout.json` (schema-strict at `schemas/stage6-readout.schema.json`). Narrative interpretation is authored by the `stage-6-insights-readout-agent` as a COMPANION artifact `06-readout-narrative.json` + `.md` (validates against `schemas/stage6-readout-narrative.schema.json`). The agent does NOT classify and does NOT mutate `06-readout.json`.
- **Three output states (helper-classified):** `decide` / `monitor` / `do_not_decide_yet`.
- `do_not_decide_yet` returned when sample-size minimum not met, learning phase incomplete, or attribution window not closed.
- Readout distinguishes **observed result** from **interpretation**. The numbers are not the conclusion.
- Caveat: Meta's reporting is increasingly modeled/obfuscated. Framework-class attribution is for *our* learning, not for claims about the platform's optimization geometry. Modeled-reporting caveat is mandatory in both the helper artifact and the narrative companion.

### Stage 7 — Refresh trigger evaluation

- Distinguish **creative saturation** (this ad/framework has been seen too much) from **audience-sequence exhaustion** (this audience has converted who's going to convert).
- These call for different responses: saturation → new framework; exhaustion → new audience or wait.
- Feeds back into Stage 1 for the next iteration.

---

## Cross-cutting Safety Rules

### Claim Register

The framework explicitly does **not** claim:
- That Meta "rewards" the Big Book taxonomy or any specific advertiser-side structure.
- That structural diversity (Big Book taxonomy) automatically produces model-visible diversity.
- That GEM/Andromeda/Sequence Learning are well-understood from outside Meta.

The framework explicitly **does** claim:
- Diverse, well-instrumented creative supply is a higher-probability strategy worth testing against the Andromeda-era retrieval pool.
- Conversion-signal quality is a higher-leverage advertiser input than targeting precision in the Sequence-Learning era.
- Single-winner-scaling in monoculture risks under-fitting a personalized retrieval pool.

### Credential and Data

- Never embed client-specific data (ad account IDs, compliance posture, tokens) in framework files.
- Compliance posture, ad account IDs, and credential references flow from `clients/<CLIENT>/projects/meta-app-integration/project.json` and the `tools/mcp/*` MCP wrappers.
- Token bytes never appear in framework artifacts, argv, chat, subagent prompts, or logs.

### Operator Gates

- Every Stage 4 submit: operator clicks Submit on the Delesign form.
- Every Stage 5 push: operator approves the Meta payload before any push-capable command runs.
- Every Stage 5 activation: operator explicitly selects the ad IDs before `tools/mcp/meta-ads/activate-ads.js` runs — a separate gate from the push approval. The tool refuses without explicit IDs (no-args = list-only) and never touches `protected_ad_ids`.
- Every Stage 7 next-iteration decision: operator approves the next message + framework mix.

### Compliance

- {CLIENT_CODE} auto financing → Meta financial-services special-ad-category (Credit). `compliance.special_ad_category_acknowledged=true` mandatory on every {CLIENT_CODE} payload.
- {CLIENT_CODE}/{CLIENT_CODE} automotive → standard category. Override to Credit if a campaign leads with financing offers.
- All clients: `compliance.ai_generated_or_altered=false` for Delesign-produced visuals (humans designed). Override to true ONLY if Delesign uses AI image generation in their pipeline for that deliverable; operator verifies per project.
- All clients: no synthetic testimonials, no fabricated endorsements, no protected-class targeting. Compliance preflight enforces; framework guardrails surface.

### Amendment B — Gemini Flash Visual-Error Cross-Check (2026-06-23)

**Operator directive 2026-06-23.** Before any visual defect in a static creative (image ad, mockup) is flagged, communicated to the designer, or used to block a Stage 3→4 transition, the Gemini Flash cross-check must have run and its verdict JSON must exist. This is a **required artifact (advisory-default), not a hard runtime gate** — the verdict is evidence, not authority; it does not by itself block the iteration pipeline. Run:

```sh
node tools/ai-bridge/creative-text-verify.js \
  --images <path-to-creative.png> \
  --expect "dealer=<Dealer Name>;est=<Year>" \
  --claim "<the specific defect claim>" \
  --output _dev/reports/analysis/creative-verify/<slug>-verdict.json
```

Engine: `tools/ai-bridge/adapters/gemini-api.js` (model: `gemini-2.5-flash`).
Memory rule: `feedback_visual-error-claims-need-gemini-flash-verify`.

**Rule:** the check must have *run* — a verdict JSON must exist before a visual-defect claim is flagged or used to hold a Stage 3→4 transition. `PASS` → defect not confirmed, do not flag. `FAIL` → flag with verdict JSON as evidence. `DISAGREE` → surface both reads, do not assert, escalate to operator. The verdict is evidence, not authority, and this requirement does not hard-block the pipeline (advisory at authoring).

**Hardening this into a real blocking gate** (e.g., blocking Stage 4 submits, automated Delesign QA) requires `/ground-in-philosophy` + operator approval, and is reversible via the bidirectional down-rung path in `_dev/concepts/lesson-enforcement-ladder.md`. This amendment governs the human-in-the-loop review step only.

---

### Re-Validation

Meta platform changes quarterly. Re-read `_dev/concepts/algo-aware-meta-creative-iteration-framework/context/meta-platform-substrate.md` and re-test the falsification criteria when a new GEM/Andromeda/Sequence-Learning-class post lands. Frameworks built on 2024–2025 substrate may need revision in 2027+.

### Video Creative Specs / Benchmarks Reference

For video creative specs (placement aspect ratios, resolution, duration, encoding, safe zones) and dated benchmarks (hook/hold rate, CTR, play rate, testing sample sizes, Andromeda performance figures), load the canonical dated reference `frameworks/_shared/reference/meta-video-creative-2025-2026.md` and check its `valid_through` before asserting any number as current fact. This framework deliberately holds only durable craft/algorithm doctrine; perishable numbers live in that reference, dated and provenance-bound. Do not inline its numbers here.

### Deferred Enhancements (do NOT implement in v1)

- Holdout/control logic.
- Multimodal metadata provisioning (alt-text, OCR-friendly overlays).
- Drift review for platform updates / seasonality.
- Cross-platform extension (Google, TikTok, etc.).
- Auto-launching campaigns without operator approval.
- File attachment uploads to Delesign briefs (text-only in v1).
- Project deletion via MCP.
