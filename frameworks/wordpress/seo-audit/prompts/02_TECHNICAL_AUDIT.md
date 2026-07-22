# 02: Technical SEO Audit

## Objective
Audit crawlability, indexation, site speed, mobile-friendliness, security, and URL structure. Produce a structured technical findings report.

## Mode
RUN_ONLY

## Inputs
- `outputs/seo-audit/intake-summary.md` from Prompt 01
- Site URL and sitemap from intake

## Steps

1. [AUTO] **Crawlability assessment:**
   - Analyze robots.txt for unintentional blocks
   - Check sitemap format, URL count, and freshness
   - Assess site architecture depth (pages within 3 clicks of homepage)
   - Check for orphan pages in sitemap not linked from navigation

2. [AUTO] **Indexation assessment:**
   - Check for noindex tags on important pages
   - Verify canonical tag implementation (self-referencing, cross-domain, HTTP/HTTPS)
   - Check for redirect chains and loops
   - Identify duplicate content without canonicals
   - Verify www vs. non-www and trailing slash consistency

3. [AUTO] **Site speed and Core Web Vitals:**
   - Run PageSpeed Insights API for homepage and 2-3 key pages
   - Record LCP, INP, CLS scores
   - Note TTFB, image optimization, JS/CSS delivery issues
   - Check caching headers and CDN usage

4. [AUTO] **Mobile-friendliness:**
   - Verify responsive design (not separate m. site)
   - Check viewport configuration
   - Test for horizontal scroll and tap target issues

5. [AUTO] **Security and HTTPS:**
   - Verify HTTPS across entire site
   - Check for mixed content
   - Verify HTTP → HTTPS redirects

6. [AUTO] **URL structure:**
   - Assess readability and keyword presence
   - Check for unnecessary parameters
   - Verify lowercase and hyphen-separated convention

7. [AUTO] Write findings to `outputs/seo-audit/technical-findings.md`.

## Outputs
- `outputs/seo-audit/technical-findings.md` with each finding containing:
  - **Issue**: What was observed
  - **Severity**: CRITICAL / MAJOR / MINOR / INFO
  - **Evidence**: URL, screenshot, tool output, or HTML element
  - **Recommendation**: Specific fix
  - Section headers: Crawlability, Indexation, Speed, Mobile, Security, URL Structure

## Success Criteria
- [ ] All 6 technical areas assessed
- [ ] Every finding has evidence citation
- [ ] PageSpeed data collected for at least homepage
- [ ] Severity levels assigned consistently
- [ ] Schema detection limitation noted if schema check was attempted

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Schema detection: do NOT report "no schema found" from web_fetch alone — see guardrails
- Mode-specific: may run PageSpeed API and fetch pages; write reports only
