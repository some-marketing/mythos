# 04: Validation

## Objective
Validate that all implemented tracking fires correctly, verify data accuracy in GA4, debug common issues, and produce a monitoring checklist for ongoing data quality.

## Mode
RUN_ONLY

## Inputs
- `outputs/analytics-tracking/intake-assessment.md` from Prompt 01
- `outputs/analytics-tracking/tracking-plan.md` from Prompt 02
- `outputs/analytics-tracking/implementation-spec.md` from Prompt 03
- `ga4_measurement_id` from project.json
- `gtm_container_id` from project.json (if applicable)

## Steps

1. [AUTO] **Build validation test matrix:**
   - List every event from the tracking plan
   - Define the trigger action for each event (page load, button click, form submit, purchase)
   - Define expected properties and values for each event
   - Define pass/fail criteria per event

2. [AUTO] **Tag firing validation** (via Playwright browser automation):
   - Load site with GA4 DebugView enabled (`?debug_mode=true`)
   - For each event in test matrix:
     - Perform the trigger action in the browser
     - Verify the event appears in the data layer (`dataLayer` inspection)
     - Verify the event fires to GA4 (network request inspection for collect endpoint)
     - Record event name, properties, and values observed
   - Flag events that do not fire or fire with incorrect properties

3. [AUTO] **Data accuracy verification:**
   - Compare fired event properties against tracking plan definitions
   - Check for missing properties (defined in plan but not present in fired event)
   - Check for unexpected properties (present in fired event but not in plan)
   - Verify conversion events include required value and currency fields
   - Check for PII leakage in any event property values
   - Verify e-commerce data accuracy if applicable (item IDs, prices, quantities)

4. [AUTO] **Common issue diagnosis:**

   **Events not firing:**
   - Check if GTM container is loaded on the page
   - Check if trigger conditions match (CSS selectors, event names, page paths)
   - Check for JavaScript errors blocking execution
   - Check if caching is serving stale pages without updated tags
   - Check consent mode — events may be blocked pending consent

   **Duplicate events:**
   - Check for multiple GTM containers on same page
   - Check for both gtag.js and GTM firing the same events
   - Check trigger firing frequency (once per page vs. every occurrence)

   **Wrong property values:**
   - Check data layer variable paths (nested objects require correct dot notation)
   - Check variable data type (string vs. number)
   - Check timing — data layer push may occur after tag fires

   **Cross-browser issues:**
   - Test in Chrome, Firefox, Safari (minimum)
   - Check mobile viewport behavior
   - Note any browser-specific failures

5. [AUTO] **Consent mode validation** (if applicable):
   - Verify tags do not fire before consent is granted
   - Grant consent and verify tags fire after consent update
   - Verify consent state persists across page loads
   - Check that consent denial properly blocks analytics tags

6. [AUTO] **GTM container review** (if applicable):
   - Verify all tags follow naming convention
   - Check for unused tags, triggers, or variables
   - Verify tag sequencing (config tag fires before event tags)
   - Note container version for documentation

7. [AUTO] **Build ongoing monitoring checklist:**
   - Weekly checks: real-time report spot check, conversion count sanity check
   - Monthly checks: event count trends, property value consistency, data freshness
   - Quarterly checks: custom dimension usage, audience health, GA4 quota usage
   - Break-glass checks: after site updates, plugin updates, or theme changes

8. [GATE] Present validation results to operator:
   - Test matrix with pass/fail per event
   - Any failing events with diagnosis
   - Monitoring checklist for ongoing maintenance
   - Recommendations for any issues found

9. [AUTO] Write validation report to `outputs/analytics-tracking/validation-report.md`.

## Outputs
- `outputs/analytics-tracking/validation-report.md` containing:
  - Validation test matrix with results: Event | Trigger | Expected | Observed | Status (PASS/FAIL)
  - Detailed findings for any FAIL results (issue, evidence, diagnosis, fix)
  - Consent mode validation results (if applicable)
  - Cross-browser test results
  - GTM container health summary
  - Ongoing monitoring checklist with frequencies
  - Data quality observations

## Success Criteria
- [ ] Every event in the tracking plan has been tested
- [ ] Test results documented with PASS/FAIL per event
- [ ] Any failing events have diagnosis and recommended fix
- [ ] No PII detected in any fired event properties
- [ ] Consent mode validated (if applicable)
- [ ] Cross-browser testing completed (minimum 2 browsers)
- [ ] Monitoring checklist produced with specific check items and frequencies
- [ ] Validation report written to outputs/
- [ ] Operator has reviewed results

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: may run browser automation, inspect network traffic, and read data layer — write reports only, no code modifications
- If validation reveals implementation issues, document them in the report — do not fix in this prompt (fixes require returning to Prompt 03 in PATCH_ALLOWED mode)
- Never access GA4 Admin or GTM Admin to verify configuration — use client-side observation only unless project.json grants admin access
