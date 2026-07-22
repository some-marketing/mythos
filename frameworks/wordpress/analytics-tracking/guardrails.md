# Analytics Tracking Guardrails

Framework-specific execution constraints. Extends system guardrails at `Mythos/.claude/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: Default for assessment and validation phases. Audit current tracking state, report findings. No changes to the site.
- **RUN_ONLY**: For automated collection (checking tag firing, verifying data layer, fetching GTM container exports). Write reports and logs only.
- **PATCH_ALLOWED**: For implementation phase only (Prompt 03). May inject tracking code, configure GTM tags, or modify data layer — but only with explicit operator confirmation per change.

## Safety Rules

### Credentials and Access
- Never store analytics credentials, API keys, or OAuth tokens in framework artifacts
- GA4 measurement IDs (G-XXXXXXXX) go in project.json `ga4_measurement_id` field, not in framework files or output artifacts
- GTM container IDs (GTM-XXXXXXX) go in project.json `gtm_container_id` field, not in framework files or output artifacts
- Tag Manager container access (publish, edit) requires an explicit grant in project.json — never assume write access
- Never store Google Ads linking credentials or conversion import tokens

### Code Injection Controls
- Never inject tracking code (gtag.js, dataLayer pushes, pixel scripts) without operator confirmation — even in PATCH_ALLOWED mode
- Every code change must be presented as a diff or snippet for review before application
- Never modify consent management platform configuration without operator review
- Never add third-party pixels (Facebook, LinkedIn, etc.) without explicit operator request and confirmation
- Data layer modifications must be documented before implementation

### Privacy Compliance
- GDPR: tracking tags must respect consent state — never fire analytics before consent is granted in EU-targeted sites
- CCPA: honor opt-out signals — note Do Not Sell requirements when applicable
- Never implement or modify cookie consent banners without operator review — consent UX has legal implications
- Never collect PII (email, phone, name) in event properties or custom dimensions
- IP anonymization settings must be noted in implementation spec
- Data retention period recommendations must be included in tracking plan
- If no consent management platform exists and the site serves EU/UK/CA users, flag this as a blocking finding before any implementation

### Output Constraints
- All findings use observational language per system guardrails
- Every finding must cite evidence (tag output, DebugView screenshot, data layer inspection, or GTM preview result)
- Severity uses CRITICAL / MAJOR / MINOR / INFO, not priority numbers
- Never claim "this will fix your tracking" — use "this addresses [specific measurement gap]"
- Implementation specs must distinguish between what GA4 provides automatically (enhanced measurement) and what requires custom implementation

### External System Interaction
- GTM Preview Mode and GA4 DebugView are permitted in RUN_ONLY and PATCH_ALLOWED modes
- Never publish a GTM container version without operator confirmation
- Never create or modify GA4 properties or data streams without operator confirmation
- PageSpeed or Lighthouse calls for performance baseline are permitted in RUN_ONLY mode
- Never submit site URLs to third-party analytics auditing tools without noting it in the report

## Checklist
- [ ] Site URL confirmed accessible before starting assessment
- [ ] Existing tracking tools inventoried before proposing changes
- [ ] Privacy/consent requirements documented before any implementation
- [ ] GA4 measurement ID sourced from project.json, not hardcoded
- [ ] GTM container access level confirmed with operator
- [ ] All code injections reviewed and confirmed by operator
- [ ] No credentials or API keys in any output artifact
- [ ] Validation testing completed with DebugView or equivalent before marking complete
