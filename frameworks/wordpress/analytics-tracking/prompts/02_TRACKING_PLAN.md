# 02: Tracking Plan

## Objective
Develop a structured tracking plan: event naming conventions, event hierarchy, event properties, conversion definitions, and UTM strategy. This plan becomes the source of truth for all implementation work.

## Mode
FINDINGS_ONLY

## Inputs
- `outputs/analytics-tracking/intake-assessment.md` from Prompt 01
- `tracking_goals` from project.json
- `key_conversions` from project.json (optional)
- `utm_conventions` from project.json (optional)
- `ecommerce_platform` from project.json (optional)

## Steps

1. [AUTO] **Establish naming conventions:**
   - Define event naming format: `object_action` (lowercase, underscores)
   - Define property naming format: `snake_case`
   - Document conventions in a reference table
   - Align with GA4 recommended event names where applicable (e.g., `purchase`, `sign_up`, `add_to_cart`)

2. [AUTO] **Build event hierarchy by category:**

   **Pageview and engagement events:**
   - Enhanced measurement events (automatic in GA4): page_view, scroll, outbound_click, site_search, file_download, video_engagement
   - Note which enhanced measurement toggles should be enabled/disabled

   **User action events** (site-type-specific):
   - CTA clicks with location and text properties
   - Form submissions with form name and location
   - Navigation interactions relevant to goals
   - Feature usage events (if applicable)

   **Conversion events:**
   - Map each tracking goal to a specific event name
   - Define counting method per conversion (once per session vs. every event)
   - Assign conversion values where applicable
   - Document the funnel sequence leading to each conversion

   **E-commerce events** (if applicable):
   - Map to GA4 recommended e-commerce events (view_item, add_to_cart, begin_checkout, purchase)
   - Define required item-level properties (item_id, item_name, price, quantity)
   - Define transaction-level properties (transaction_id, value, currency)

3. [AUTO] **Define event properties:**
   - Standard properties per event (with expected values and data types)
   - User properties for custom dimensions (user_type, plan_type, account_id)
   - Content properties for segmentation (content_group, page_type, author)
   - Campaign properties (source, medium, campaign, content, term)
   - Flag any properties that risk containing PII and propose alternatives

4. [AUTO] **Define custom dimensions and metrics:**
   - List custom dimensions needed in GA4 (name, scope, parameter mapping)
   - List custom metrics needed (name, unit, parameter mapping)
   - Note GA4 limits: 50 event-scoped, 25 user-scoped custom dimensions

5. [AUTO] **Define conversion configuration:**
   - List each conversion event with counting method and default value
   - Define audience segments for remarketing (high-intent visitors, purchasers, engaged users)
   - Map conversion events to funnel stages

6. [AUTO] **Build UTM parameter strategy:**
   - Define naming conventions for source, medium, campaign, content, term
   - Create a UTM template for common channels (email, social, paid search, display)
   - Document conventions to prevent inconsistency (lowercase, no spaces, separator character)

7. [GATE] Present tracking plan to operator for review:
   - Event inventory with properties
   - Conversion definitions
   - UTM conventions
   - Any decisions requiring business input (which actions count as conversions, conversion values)

8. [AUTO] Write tracking plan to `outputs/analytics-tracking/tracking-plan.md`.

## Outputs
- `outputs/analytics-tracking/tracking-plan.md` containing:
  - Naming conventions reference
  - Complete event inventory table: Event Name | Category | Properties | Trigger | Conversion (Y/N)
  - Event properties reference table
  - Custom dimensions and metrics list
  - Conversion configuration table: Conversion | Event | Counting Method | Value
  - Funnel definitions
  - UTM parameter strategy and templates
  - GA4 enhanced measurement settings (enable/disable per toggle)

## Success Criteria
- [ ] Naming conventions defined and consistently applied across all events
- [ ] Every tracking goal maps to at least one measurable event
- [ ] Every event has defined properties with expected values
- [ ] Conversion events identified with counting method specified
- [ ] No PII in any event property definition
- [ ] UTM conventions documented with channel templates
- [ ] GA4 recommended event names used where applicable
- [ ] Tracking plan reviewed by operator

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: planning and documentation only, no implementation
- Never include measurement IDs or container IDs in the tracking plan — reference project.json
- Event properties must never capture PII (email, phone, full name, IP address)
