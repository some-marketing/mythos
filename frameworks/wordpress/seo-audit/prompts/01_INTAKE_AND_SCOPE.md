# 01: Intake and Scope

## Objective
Gather site context, confirm audit scope, and establish the baseline before any technical analysis begins.

## Mode
FINDINGS_ONLY

## Inputs
- `site_url` from project.json (required)
- `site_type` from project.json (required)
- `seo_goals` from project.json (required)
- `priority_keywords` (optional)
- `audit_scope` (optional — full site or specific pages)

## Steps

1. [AUTO] Read project.json for site URL, type, and goals.
2. [AUTO] Fetch robots.txt and check for sitemap reference.
3. [AUTO] Fetch XML sitemap and count indexable URLs.
4. [AUTO] Run `site:domain.com` equivalent check to estimate indexed page count.
5. [AUTO] Identify site type (SaaS, e-commerce, blog, local business, WordPress multisite) and note type-specific audit considerations.
6. [GATE] Confirm audit scope with operator:
   - Full site vs. specific pages/sections
   - Technical + on-page + content, or focused area
   - Available data sources (Search Console exports, analytics, Screaming Frog)
7. [AUTO] Write intake summary to `outputs/seo-audit/intake-summary.md`.

## Outputs
- `outputs/seo-audit/intake-summary.md` containing:
  - Site URL, type, and goals
  - Sitemap status and URL count
  - Estimated index coverage
  - Confirmed audit scope
  - Available data sources
  - Type-specific considerations to check in subsequent prompts

## Success Criteria
- [ ] Site URL is accessible (HTTP 200 or redirect to HTTPS)
- [ ] Robots.txt retrieved and analyzed
- [ ] Sitemap located or noted as missing
- [ ] Audit scope confirmed with operator
- [ ] Intake summary written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific constraints: no file writes to the site, no external tool submissions
