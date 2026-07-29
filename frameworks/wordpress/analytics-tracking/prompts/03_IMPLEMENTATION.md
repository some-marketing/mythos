# 03: Implementation

## Objective
Implement the tracking plan: configure GA4 settings, build GTM container structure, implement custom events via data layer, configure conversions, and set up consent mode integration. All code changes require operator confirmation.

## Mode
PATCH_ALLOWED

## Inputs
- `outputs/analytics-tracking/intake-assessment.md` from Prompt 01
- `outputs/analytics-tracking/tracking-plan.md` from Prompt 02
- `ga4_measurement_id` from project.json (required for this prompt)
- `gtm_container_id` from project.json (required if using GTM)
- `consent_management_platform` from project.json (optional)

## Steps

1. [AUTO] **Verify prerequisites:**
   - Confirm GA4 measurement ID is available in project.json
   - Confirm GTM container ID and access level (if GTM is the implementation path)
   - Confirm consent management approach from intake assessment
   - Load tracking plan and build implementation checklist

2. [GATE] **Confirm implementation approach with operator:**
   - GTM-based implementation (preferred) vs. direct gtag.js
   - Consent mode configuration approach
   - Which event categories to implement in this pass
   - Any staging/development environment for testing before production

3. [AUTO] **GA4 configuration spec:**
   - Document enhanced measurement settings to enable/disable
   - List custom dimensions to create in GA4 Admin (name, scope, parameter)
   - List custom metrics to create in GA4 Admin (name, unit, parameter)
   - Document data retention setting recommendation (14 months)
   - Note internal traffic filter configuration (IP ranges from operator)
   - Document cross-domain tracking configuration if multiple domains

4. [AUTO] **GTM container structure** (if GTM path):

   **Tags to create:**
   - GA4 Configuration tag with measurement ID (from project.json)
   - GA4 Event tags per custom event in tracking plan
   - Consent mode default/update tags (if consent management exists)

   **Triggers to create:**
   - Custom Event triggers for each data layer event
   - Click triggers for CTA tracking (with CSS selector or Click Text conditions)
   - Form submission triggers (with form ID or class conditions)
   - Page View triggers for specific page-based events

   **Variables to create:**
   - Data Layer variables for each event property
   - Constant variable for GA4 measurement ID
   - Any Lookup Table or RegEx Table variables needed

   Present complete tag/trigger/variable spec as a structured document.

5. [GATE] **Review implementation spec before any code changes:**
   - Present each tag with its trigger and variables
   - Present each data layer push with its trigger point
   - Confirm operator approves before writing any code

6. [AUTO] **Data layer implementation code:**
   - Generate data layer push snippets for each custom event
   - Document where each snippet should be placed (which template, which hook, which plugin)
   - For WooCommerce: map e-commerce events to WooCommerce hooks
   - For forms: map form submission events to form plugin hooks (Gravity Forms, WPForms, CF7)

   Present all code as reviewable snippets, not direct file writes.

7. [GATE] **Operator confirms each code injection before application:**
   - Review data layer snippets
   - Confirm file locations for code placement
   - Approve or modify before any file is written

8. [AUTO] **Consent mode implementation** (if applicable):
   - Document consent mode default state (denied)
   - Document consent update integration with CMP
   - Specify which tags require which consent types (analytics_storage, ad_storage)
   - Present consent mode code for operator review

9. [AUTO] Write implementation specification to `outputs/analytics-tracking/implementation-spec.md`.

## Outputs
- `outputs/analytics-tracking/implementation-spec.md` containing:
  - GA4 Admin configuration checklist (dimensions, metrics, retention, filters)
  - GTM container specification (tags, triggers, variables — with naming convention)
  - Data layer implementation code per event (with placement instructions)
  - Consent mode configuration
  - WordPress-specific integration notes (hooks, plugin compatibility)
  - Implementation order recommendation

## Success Criteria
- [ ] Every event in the tracking plan has a corresponding implementation spec
- [ ] GTM tags follow naming convention: `[Type] - [Description] - [Detail]`
- [ ] Every data layer push includes placement instructions (file, hook, or plugin)
- [ ] Consent mode addressed (implemented, deferred with rationale, or not applicable)
- [ ] No measurement IDs hardcoded — all reference project.json or GTM constant variable
- [ ] Every code change was presented for operator review before application
- [ ] E-commerce event mapping complete (if applicable)
- [ ] Implementation spec written to outputs/

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- PATCH_ALLOWED constraints: every code injection requires explicit operator confirmation
- Never publish GTM container without operator confirmation
- Never modify consent management platform configuration without operator review
- Never hardcode measurement IDs or container IDs in theme files — use GTM constant variables or project.json references
- Present all code as reviewable diffs/snippets before applying
