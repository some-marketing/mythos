# Page CRO Guardrails

Framework-specific execution constraints. Extends system guardrails at `Mythos/.claude/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: Default for all analysis phases. Read page, analyze, report. No changes to the site.
- **REVIEW_ONLY**: For reviewing previous CRO outputs against current page state or post-experiment results.

## Safety Rules

### Data Protection
- Never store site credentials, analytics tokens, or heatmap API keys in audit artifacts
- Never include client PII (email addresses, phone numbers) in reports unless directly relevant to a conversion finding (e.g., form field analysis)
- Audit artifacts go to the project's `outputs/page-cro/` directory only

### Output Constraints
- All findings use observational language per system guardrails
- Never say "this page is broken" or "this page has bad conversions" — describe what was observed
- Every finding must cite evidence (URL, screenshot, specific HTML element, or behavioral data)
- Severity uses HIGH_IMPACT / MEDIUM_IMPACT / LOW_IMPACT / INFORMATIONAL, not priority numbers
- Never guarantee conversion improvements — use "this may improve" or "this change is expected to reduce friction" language
- Never claim specific conversion lift percentages without data to support them

### Conversion Claims
- Frame all recommendations as hypotheses, not prescriptions
- Use "based on [evidence], [change] may improve [metric]" structure
- Never present copy alternatives as objectively better — present them as variations worth testing
- A/B test recommendations must always include a hypothesis, measurement plan, and estimated duration
- Never recommend removing page elements without stating the tradeoff

### External System Interaction
- Browser automation (Playwright) may be used to render pages and capture state
- Never submit page URLs to third-party analysis tools without noting it in the report
- Never interact with forms, CTAs, or conversion flows during audit — observe only
- No site modifications of any kind during audit

### Page-Type Sensitivity
- Landing pages from paid traffic: note that changes affect ad quality score and message match
- Pricing pages: note that pricing display changes carry revenue risk and require careful testing
- Checkout flows: never recommend changes without flagging payment/trust implications

## Checklist
- [ ] Page URLs confirmed accessible before starting audit
- [ ] Page type and conversion goals confirmed with operator
- [ ] All findings cite evidence
- [ ] No client credentials in any audit artifact
- [ ] Recommendations framed as hypotheses, not guarantees
- [ ] A/B test proposals include hypothesis, variants, success metrics, and duration estimate
- [ ] No site modifications made during audit
- [ ] Copy alternatives presented as testable variations, not replacements
