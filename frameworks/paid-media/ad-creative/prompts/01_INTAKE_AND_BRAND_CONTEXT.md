# 01: Intake and Brand Context

## Objective
Gather product context, brand voice, platform requirements, existing ad performance data, and competitor ad landscape before generating any creative.

## Mode
FINDINGS_ONLY

## Inputs
- `platform` from project.json (required)
- `campaign_objective` from project.json (required)
- `target_audience` from project.json (required)
- `product_description` from project.json (required)
- `brand_voice` (optional)
- `existing_ads` (optional — current ad copy with performance data)
- `landing_page_urls` (optional)
- `competitor_ads` (optional)
- `character_limits` (optional — overrides for platform defaults)

## Steps

1. [AUTO] Read project.json for platform, campaign objective, target audience, and product description.

2. [AUTO] **Product and offer context:**
   - Identify core value proposition from product_description
   - Determine what is being promoted (product, feature, free trial, demo, lead magnet)
   - Note key differentiators from competitors
   - Extract specific proof points (numbers, awards, customer count, performance claims)

2b. [AUTO] **Confirmed-terms ledger (see `guardrails.md` → Amendment B — Confirmed-Terms Binding Preflight).**
   Capture every offer term/fact that copy might surface — price, promo code, guarantee, freebie/mechanic, dates, awards, quantified claims — as a **ledger**, one row per fact. This is the source of truth that later copy is bound to. **Never assume a term is confirmed.**
   - For each fact record: `id`, `statement`, `status` (`confirmed`|`pending`), `provenance` (citation of the client source — email/call quote + date), `disposition` (`must-appear`|`optional`|`context-only`), `anchors` (the load-bearing tokens that must literally appear in copy).
   - **Provenance binding:** a fact with **no cited client source is `pending`**, not confirmed — it must not be baked into copy as settled.
   - **Confirmed-label integrity:** do not mark a fact `confirmed` unless `provenance` is a real client source. A "confirmed terms" doc that carries an uncited fact is the exact defect this prevents.
   - Write the ledger to `outputs/ad-creative/confirmed-terms-ledger.json` (array of rows). Missing provenance is expected early — leave `status: pending` and surface it at the operator gate for the client to confirm.

3. [AUTO] **Human-voice capture (see `guardrails.md` → Human Voice).** Generate from a real **exemplar**, never from adjectives.
   - Capture 1–3 real human **exemplar lines** to imitate (owner/operator quote, an existing high-performing ad, or the script) + the transform rule: *"write as [named speaker] would say it, to [this buyer], in [this buying moment]."* Name the speaker persona explicitly.
   - Adjectives ("friendly, direct") are documented as NOTES only — never as the generation source.
   - **If no exemplar exists:** do NOT proceed on adjectives and do NOT let "gap acknowledged" pass. Select a fallback archetype from `assets/voice-archetypes.md` (e.g. "Plain-Spoken Local Owner") and record a LOUD warning that a default voice is in use until a real exemplar is supplied.
   - For local/community clients, apply the local-register primer (plain-spoken owner talking to a neighbour).
   - Document forbidden words, required terminology, and mandatory elements (brand name placement, trademark symbols, required disclaimers).

4. [AUTO] **Platform requirements:**
   - Document character limits for each target platform and format:
     - Google RSA: headlines 30 chars, descriptions 90 chars
     - Meta: primary text 125 visible (2,200 max), headline 40 chars, description 30 chars
     - LinkedIn: intro text 150 recommended (600 max), headline 70 recommended (200 max)
   - Apply any character_limits overrides from input
   - Note format-specific requirements (RSA combination rules, Meta primary text front-loading)

5. [AUTO] **Audience and intent analysis:**
   - Map target_audience to awareness stage (problem-aware, solution-aware, product-aware)
   - Identify primary pain points and desires
   - Note job-specific language or terminology the audience uses
   - Document intent signals that inform angle selection

6. [AUTO] **Existing ad performance review** (if existing_ads provided):
   - Identify top performers by CTR, conversion rate, or ROAS (ask which metric matters most if unclear)
   - Analyze winning themes: topics, structures (question/statement/command), word patterns, character utilization
   - Analyze underperformers: themes that fall flat, common patterns in low performers
   - Document tested angles and untested angles

7. [AUTO] **Competitor ad review** (if competitor_ads provided):
   - Document competitor messaging angles
   - Note differentiation opportunities
   - Identify overused angles in the competitive landscape
   - Flag any competitor trademark references for operator review

8. [GATE] Confirm context with operator:
   - Platform(s) and format(s) confirmed
   - Brand voice constraints understood (or gap acknowledged)
   - Campaign objective clear
   - Available data sources confirmed
   - Any compliance or industry-specific requirements noted
   - **Confirmed-terms ledger reviewed:** every `confirmed` row has provenance; every `pending` row flagged to the operator/client for confirmation before it can be used as a settled claim

9. [AUTO] Write intake summary to `outputs/ad-creative/intake-and-brand-context.md` and the ledger to `outputs/ad-creative/confirmed-terms-ledger.json`.

## Outputs
- `outputs/ad-creative/intake-and-brand-context.md` containing:
  - Product and offer summary with proof points
  - Brand voice constraints (or gap note)
  - Platform(s) with character limits per element
  - Audience profile with awareness stage and pain points
  - Existing performance analysis (if data provided)
  - Competitor landscape observations (if data provided)
  - Confirmed scope and constraints
  - Recommended angles to explore in Prompt 02
- `outputs/ad-creative/confirmed-terms-ledger.json` — the confirmed-terms ledger (one row per offer fact, with `status`, `provenance`, `disposition`, `anchors`) that copy is bound to and diffed against in Prompt 03 (see `guardrails.md` → Amendment B).

## Success Criteria
- [ ] Product value proposition clearly articulated with specific proof points
- [ ] Confirmed-terms ledger captured: every offer fact has `status` + `provenance`; uncited facts marked `pending`, never assumed confirmed
- [ ] Platform character limits documented for every target format
- [ ] Brand voice constraints captured or gap flagged
- [ ] Audience awareness stage identified
- [ ] At least 3-5 recommended angles documented for headline generation
- [ ] Scope confirmed with operator
- [ ] Intake summary written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific constraints: research and analysis only, no creative output in this prompt
- Competitor analysis is observational — no trademark usage in outputs
