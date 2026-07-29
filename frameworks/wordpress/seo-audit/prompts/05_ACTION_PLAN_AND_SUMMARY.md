# 05: Action Plan and Executive Summary

## Objective
Synthesize all findings into a prioritized action plan and executive summary. This is the client-facing deliverable.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/seo-audit/intake-summary.md` from Prompt 01
- `outputs/seo-audit/technical-findings.md` from Prompt 02
- `outputs/seo-audit/on-page-findings.md` from Prompt 03
- `outputs/seo-audit/content-findings.md` from Prompt 04

## Steps

1. [AUTO] **Aggregate all findings** from Prompts 02-04.
   - Count findings by severity (CRITICAL, MAJOR, MINOR, INFO)
   - Group by category (Technical, On-Page, Content)

2. [AUTO] **Build prioritized action plan** at `outputs/seo-audit/action-plan.md`:

   **Tier 1 — Critical fixes** (blocking indexation or ranking):
   - Issues that prevent Google from crawling or indexing the site
   - Broken HTTPS, noindex on key pages, robots.txt blocks

   **Tier 2 — High-impact improvements:**
   - Issues affecting ranking potential across multiple pages
   - Title/heading optimization, internal linking, content depth

   **Tier 3 — Quick wins** (easy, immediate benefit):
   - Issues that can be fixed in under an hour with measurable impact
   - Missing alt text, meta description improvements, broken links

   **Tier 4 — Long-term recommendations:**
   - Content strategy gaps, E-E-A-T improvements, site architecture changes
   - Items that require planning or ongoing effort

3. [AUTO] **Write executive summary** at `outputs/seo-audit/executive-summary.md`:
   - Overall site health assessment (observational, not scored)
   - Top 3-5 priority observations
   - Quick wins identified
   - Findings count by severity
   - Recommended next steps

4. [GATE] Present executive summary to operator for review before finalizing.

## Outputs
- `outputs/seo-audit/action-plan.md` — prioritized by severity tier with specific fixes per finding
- `outputs/seo-audit/executive-summary.md` — client-facing overview

## Success Criteria
- [ ] All findings from Prompts 02-04 accounted for in action plan
- [ ] Action plan organized by severity tier, not by audit phase
- [ ] Executive summary is concise (under 2 pages equivalent)
- [ ] Top 3-5 priorities clearly identified
- [ ] No new findings introduced (this prompt synthesizes, not audits)
- [ ] Observational language maintained throughout (no "this will fix your rankings")
- [ ] Operator has reviewed executive summary before finalization

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: review and synthesize existing outputs only; no new data collection
- Never add severity scores or health percentages — let the findings speak
