# 03: On-Page SEO Audit

## Objective
Audit title tags, meta descriptions, heading structure, content optimization, image optimization, internal linking, and keyword targeting across the site's key pages.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/seo-audit/intake-summary.md` from Prompt 01
- `outputs/seo-audit/technical-findings.md` from Prompt 02
- Priority keywords from project.json (if provided)

## Steps

1. [AUTO] Select audit page set:
   - Homepage
   - Top 5-10 pages by importance (from sitemap, navigation, or operator input)
   - Any pages specifically flagged in intake

2. [AUTO] **Title tag audit** (per page):
   - Check uniqueness across site
   - Verify length (50-60 chars)
   - Check primary keyword placement
   - Flag duplicates, truncation, stuffing, or missing titles

3. [AUTO] **Meta description audit** (per page):
   - Check uniqueness and length (150-160 chars)
   - Verify keyword inclusion and CTA presence
   - Flag duplicates, auto-generated, or missing descriptions

4. [AUTO] **Heading structure audit** (per page):
   - Verify single H1 per page with primary keyword
   - Check logical hierarchy (H1 → H2 → H3, no skips)
   - Flag multiple H1s, missing H1s, or style-only headings

5. [AUTO] **Content optimization audit** (per page):
   - Check keyword presence in first 100 words
   - Assess content depth relative to topic
   - Flag thin content pages
   - Check search intent alignment

6. [AUTO] **Image optimization audit** (sampled):
   - Check alt text presence and quality
   - Check file formats (WebP preferred)
   - Check lazy loading implementation
   - Flag missing alt text or generic filenames

7. [AUTO] **Internal linking audit:**
   - Check that important pages are well-linked
   - Flag orphan pages and broken internal links
   - Assess anchor text quality

8. [AUTO] **Keyword targeting audit:**
   - Check title/H1/URL alignment per page
   - Flag keyword cannibalization (multiple pages targeting same keyword)
   - Identify coverage gaps

9. [AUTO] Write findings to `outputs/seo-audit/on-page-findings.md`.

## Outputs
- `outputs/seo-audit/on-page-findings.md` with per-page and site-wide findings, each containing:
  - **Issue**: What was observed
  - **Severity**: CRITICAL / MAJOR / MINOR / INFO
  - **Evidence**: Page URL + specific element
  - **Recommendation**: Specific fix

## Success Criteria
- [ ] At least homepage + 5 key pages audited
- [ ] All 7 on-page areas assessed
- [ ] Keyword cannibalization checked across pages
- [ ] Every finding cites the specific page and element
- [ ] No findings make claims about schema from static HTML

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: read and analyze only, no site modifications
