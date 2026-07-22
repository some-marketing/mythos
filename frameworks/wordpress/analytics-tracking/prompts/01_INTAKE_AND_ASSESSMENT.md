# 01: Intake and Assessment

## Objective
Gather business context, inventory the current tracking state, identify technical constraints and privacy requirements, and establish the baseline before any tracking plan development begins.

## Mode
FINDINGS_ONLY

## Inputs
- `site_url` from project.json (required)
- `site_type` from project.json (required)
- `tracking_goals` from project.json (required)
- `existing_tracking_tools` (optional — GA4, GTM, Mixpanel, etc.)
- `privacy_requirements` (optional — GDPR, CCPA, or other)
- `ecommerce_platform` (optional — WooCommerce, Shopify, etc.)

## Steps

1. [AUTO] Read project.json for site URL, type, tracking goals, and any pre-configured measurement IDs.

2. [AUTO] **Current tracking inventory:**
   - Load site in browser (Playwright) and inspect for existing analytics tags
   - Check for gtag.js, GTM container snippet, or other analytics scripts in page source
   - Identify all active tracking pixels (GA4, Facebook, LinkedIn, etc.)
   - Note Google Tag Manager container ID if present
   - Check for data layer initialization (`window.dataLayer`)
   - Record GA4 measurement ID if detected

3. [AUTO] **Technical environment assessment:**
   - Identify CMS and version (WordPress version, theme, relevant plugins)
   - Check for caching plugins that may affect tag firing (WP Rocket, W3 Total Cache, etc.)
   - Check for existing consent management platform (CookieYes, Complianz, CookieBot, etc.)
   - Note any tag management conflicts (multiple GTM containers, inline + GTM hybrid)
   - Identify e-commerce plugin if applicable (WooCommerce, Easy Digital Downloads)

4. [AUTO] **Privacy and compliance scan:**
   - Check for cookie consent banner presence
   - Verify whether analytics tags fire before or after consent
   - Note geographic targeting (EU, UK, CA visitors = GDPR/CCPA relevant)
   - Check for privacy policy page with analytics disclosure
   - Flag if consent management is absent and privacy requirements apply
   - **CMP/consent gate evaluation:** If the site meets ANY of these conditions:
     - Collects PII via forms (contact forms, account creation, newsletter signup)
     - Runs remarketing tags (Meta Pixel, Google Ads remarketing, LinkedIn Insight)
     - Uses session replay tools (Clarity, Hotjar, FullStory)
     - Serves visitors in GDPR/CCPA jurisdictions
   Then determine consent_status:
     - `"compliant"` — CMP is present and tags fire after consent
     - `"planned"` — No CMP yet but a CMP implementation task exists (document which CMP and timeline)
     - `"BLOCKED"` — No CMP, no plan, and site requires one based on conditions above
   Record consent_status in the intake assessment. If BLOCKED, this becomes a blocking issue in Step 6.

5. [AUTO] **Business context documentation:**
   - Record stated tracking goals from project.json
   - Identify key conversion actions relevant to the site type
   - Note any existing conversion tracking or goals configured in GA4

6. [GATE] Confirm assessment findings and scope with operator:
   - Current tracking state summary
   - Privacy compliance status and consent_status value
   - Proposed scope: which events, which tools, which pages
   - Any blocking issues that must be resolved before proceeding
   - **If consent_status is BLOCKED:** Do not proceed to Prompt 02 until the operator records a CMP decision (which platform, implementation timeline) in project.json `consent_management_platform` field. This is a hard gate — implementation without consent management creates legal risk.

7. [AUTO] Write assessment to `outputs/analytics-tracking/intake-assessment.md`.

## Outputs
- `outputs/analytics-tracking/intake-assessment.md` containing:
  - Site URL, type, and tracking goals
  - Current tracking tool inventory (with detected IDs)
  - Technical environment summary (CMS, plugins, caching)
  - Privacy/consent compliance status
  - Key conversion actions identified
  - Confirmed scope for tracking plan
  - Blocking issues (if any)

## Success Criteria
- [ ] Site URL is accessible and loads in browser automation
- [ ] All existing tracking tags identified and documented
- [ ] Consent/privacy status assessed (compliant, non-compliant, or not applicable)
- [ ] Technical environment constraints noted (caching, plugin conflicts)
- [ ] Scope confirmed with operator before proceeding
- [ ] Assessment written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific constraints: read and inspect only, no tag modifications, no code injection
- Never store detected measurement IDs or container IDs in framework files — record in project.json
