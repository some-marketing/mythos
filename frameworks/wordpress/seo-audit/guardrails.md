# SEO Audit Guardrails

Framework-specific execution constraints. Extends system guardrails at `Mythos/.claude/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: Default for all audit phases. Read site, analyze, report. No changes to the site.
- **RUN_ONLY**: For automated collection scripts (PageSpeed API, sitemap fetch, robots.txt fetch). Write reports and logs only.
- **REVIEW_ONLY**: For reviewing previous audit outputs against current site state.

## Safety Rules

### Data Protection
- Never store site credentials, Search Console tokens, or analytics API keys in audit artifacts
- Never include client PII (email addresses, phone numbers) in reports unless directly relevant to an SEO finding (e.g., NAP consistency)
- Audit artifacts go to the project's `outputs/seo-audit/` directory only

### Output Constraints
- All findings use observational language per system guardrails
- Every finding must cite evidence (URL, screenshot, tool output, or specific HTML element)
- Severity uses CRITICAL / MAJOR / MINOR / INFO, not priority numbers
- Never prescribe "this will fix your rankings" — use "this addresses [specific technical issue]"

### Schema Detection
- `web_fetch` and `curl` CANNOT reliably detect JSON-LD structured data — many CMS plugins inject it via JavaScript
- Never report "no schema found" based solely on static HTML fetching
- Use browser automation (Playwright), Google Rich Results Test, or client-provided Screaming Frog exports for schema validation
- If browser automation is unavailable, explicitly note "schema status unverified — requires JavaScript rendering" rather than making claims

### External System Interaction
- PageSpeed Insights API calls are permitted in RUN_ONLY mode
- Search Console data should come from client-provided exports, not direct API access (unless project.json grants it)
- Never submit URLs to third-party tools without noting it in the report (some tools cache/index submitted URLs)

## Checklist
- [ ] Site URL confirmed accessible before starting audit
- [ ] Audit scope agreed with operator (full site vs. specific pages)
- [ ] Schema detection method documented (not relying on web_fetch alone)
- [ ] All findings cite evidence
- [ ] No client credentials in any audit artifact
- [ ] Action plan prioritized by severity, not by ease of implementation
