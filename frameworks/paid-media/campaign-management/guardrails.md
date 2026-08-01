# Campaign Management Guardrails

Framework-specific execution constraints. Extends system guardrails at `Mythos/.claude/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: Default for intake, account audit, and campaign structure design. Analyze and report. No platform changes.
- **REVIEW_ONLY**: For ad copy generation and launch planning. Produce recommendations for operator review before any platform action.
- **PATCH_ALLOWED**: For updating existing campaign artifacts based on performance data or operator feedback.

## Safety Rules

### Credential and Billing Protection
- Never store ad platform credentials, API keys, OAuth tokens, or billing information in any framework artifact
- Never include client billing data, payment methods, or invoicing details in framework files
- Ad platform access is manual — the operator executes all platform changes

### Budget and Performance Language
- Budget recommendations are observations, not guarantees: use "at this budget level, expect..." not "this will generate..."
- ROAS/CPA projections must cite historical data or industry benchmarks as their basis; never invent performance numbers
- Never claim specific conversion counts, revenue figures, or traffic volumes as outcomes of a recommendation
- Use ranges and qualifiers: "industry benchmarks suggest a CPA range of $X-$Y for this vertical" not "your CPA will be $X"

### Platform Execution
- Never auto-submit campaigns, ad groups, ads, or budget changes to any ad platform
- All platform changes require operator execution — this framework produces plans, not API calls
- Campaign naming conventions, bid changes, and targeting adjustments are recommendations until the operator applies them
- Note clearly when a recommendation is platform-specific (Google Ads vs. Meta vs. LinkedIn vs. other)

### Platform-Specific Labeling
- Every recommendation must indicate which platform(s) it applies to
- Do not generalize platform-specific features across platforms (e.g., Google Ad Extensions do not exist on Meta)
- When a strategy differs by platform, provide separate recommendations per platform

### Output Constraints
- All findings use observational language per system guardrails
- Performance projections cite their source (historical data, industry benchmark, platform average)
- Severity uses HIGH_IMPACT / MEDIUM_IMPACT / LOW_IMPACT / INFO for audit findings
- Creative briefs are suggestions for operator review, not final assets

### Ad-Change Ledger (required artifact — the anti-see-saw record)

**Operator directive 2026-06-23.** Every live ad-account mutation (budget change, bid change, audience/targeting edit, status flip, creative swap, new ad/ad-set/campaign push) must produce an **AdChangeLedger** entry. The ledger is the anti-see-saw record: it makes a reversal cost a written justification instead of a quiet re-flip a week later.

- **Required-artifact expectation, not a blocking runtime gate (advisory-default).** A live change is not considered *done* without its ledger entry, but the framework does not hard-block the mutation tool on the entry's presence — the requirement is surfaced advisory and enforced as a completeness check on the change record. (No new hard runtime gate is added here.)
- **Required fields per entry:** `what` (the exact mutation), `why` (the hypothesis/reason), `expected` (what should happen if the change is right), `would_be_wrong_if` (the falsifier — the observation that would mean this change was a mistake), and `review_date` (when to come back and check `expected` against reality).
- The `would_be_wrong_if` + `review_date` fields are load-bearing: they convert a one-way change into a checkable claim, so a later reversal must reckon with the prior reasoning rather than silently undoing it.
- Coordinator-discipline around who applies the change stays a contract surface (memory + SessionStart), not a gate. Demotion/relaxation of this requirement follows the bidirectional down-rung path in `_dev/concepts/lesson-enforcement-ladder.md`.

## Checklist
- [ ] Platform(s) confirmed with operator before starting
- [ ] AdChangeLedger entry recorded for every live ad-account mutation (what · why · expected · would-be-wrong-if · review-date) — required artifact, advisory-surfaced
- [ ] Budget confirmed and documented in intake
- [ ] Campaign objective aligned with business goals (not just platform defaults)
- [ ] No ad platform credentials in any artifact
- [ ] No client billing data in any artifact
- [ ] All performance projections cite their basis
- [ ] Platform-specific recommendations labeled by platform
- [ ] All campaign changes marked as requiring operator execution
