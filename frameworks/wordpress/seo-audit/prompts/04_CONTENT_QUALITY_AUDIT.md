# 04: Content Quality Assessment

## Objective
Assess content quality through E-E-A-T signals, content depth, and type-specific issues. Identify content gaps and quality problems that affect ranking potential.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/seo-audit/intake-summary.md` from Prompt 01
- `outputs/seo-audit/on-page-findings.md` from Prompt 03
- Site type from intake (determines type-specific checks)

## Steps

1. [AUTO] **E-E-A-T signal assessment:**
   - **Experience**: Check for first-hand experience, original data, real examples
   - **Expertise**: Check for author credentials, bio pages, detailed information
   - **Authoritativeness**: Check for industry recognition signals, citations
   - **Trustworthiness**: Check for contact info, privacy policy, terms, HTTPS

2. [AUTO] **Content depth assessment** (key pages):
   - Compare content comprehensiveness against top-ranking competitors for target keywords
   - Check for follow-up question coverage
   - Flag thin or shallow content
   - Note content freshness (last updated dates)

3. [AUTO] **Type-specific content issues:**

   **WordPress / Blog sites:**
   - Outdated content not refreshed
   - Keyword cannibalization across posts
   - Missing topical clustering
   - Poor internal linking between related posts
   - Missing or weak author pages

   **SaaS / Product sites:**
   - Product pages lacking content depth
   - Blog not integrated with product pages
   - Missing comparison/alternative pages
   - Feature pages thin on content

   **E-commerce:**
   - Thin category pages
   - Duplicate product descriptions
   - Faceted navigation creating duplicates
   - Out-of-stock pages mishandled

   **Local business:**
   - Inconsistent NAP (Name, Address, Phone)
   - Missing local schema
   - No location-specific content

4. [AUTO] Write findings to `outputs/seo-audit/content-findings.md`.

## Outputs
- `outputs/seo-audit/content-findings.md` containing:
  - E-E-A-T assessment summary
  - Content depth findings per key page
  - Type-specific issues
  - Content gap observations

## Success Criteria
- [ ] E-E-A-T signals assessed across all 4 dimensions
- [ ] Content depth compared against at least 2-3 competitor equivalents
- [ ] Type-specific checks run for the correct site type
- [ ] Findings use observational language (not prescriptive)
- [ ] Content gaps identified as observations, not diagnoses

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: read and analyze only
- Never claim "this content is low quality" — describe what was observed and how it compares
