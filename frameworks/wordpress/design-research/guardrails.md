# Design Research — Guardrails

## Execution Mode

**FINDINGS_ONLY** — This framework produces text output only. No live system interaction, no code execution, no API calls.

## Rules

### No Credential Handling
- This framework does not require any credentials, API keys, or authentication tokens.
- No credentials should be stored, passed, or referenced at any point in the workflow.

### Output Constraints
- The sole output is a completed text prompt (`completed_research_prompt.md`).
- No code is generated or executed.
- No files are modified outside the project's `outputs/` directory.
- No external services are contacted during prompt generation.

### PII Protection
- Generated prompts must not contain real client PII beyond what is necessary for the research query (business name, service area, public website URL).
- Personal phone numbers, home addresses, personal email addresses, and financial details must never appear in the generated prompt.
- If intake data contains PII beyond business-level information, it must be excluded from the output prompt.

### Variable Completeness
- All `{{VARIABLE}}` placeholders must be filled before the output is considered complete.
- A prompt containing any unfilled `{{VARIABLE}}` placeholder is invalid and must not be delivered.
- The generate workflow must validate that zero placeholders remain before writing the output file.

### Scope Boundaries
- The research prompt workflow generates a research prompt only. It does not execute the research.
- It does not interact with Perplexity, ChatGPT, or any other AI research tool.
- It does not modify any system files, configurations, or infrastructure.

---

## Site Audit Capability

### Execution Mode

**FINDINGS_ONLY + PATCH_ALLOWED** — Browser interaction is read-only (no form submissions, no logins, no data mutations on target sites). Evidence files and analysis reports are written to the local filesystem under the audit base path.

### Rules

#### Read-Only Browsing
- MUST NOT submit forms, create accounts, or mutate data on target sites
- MUST NOT attempt to log in or access authenticated content
- Only publicly accessible pages are audited
- Close browser between sites (single browser session at a time)

#### Evidence-First Capture
- Always capture screenshot + DOM snapshot before attempting extraction
- Evidence structure follows a strict per-site directory layout
- All 6 capture phases must complete per site before analysis begins

#### Observational Reporting
- All analysis output must use observational reporting principles
- Use `**Observation:**` and `**HYPOTHESIS:**` labels
- Do not use prescriptive language: no "Root Cause:", "Diagnosis:", "Recommendation:", "Action Required:"
- Present findings as testable hypotheses, not definitive conclusions

#### Error Isolation
- If one site fails capture, log the error in its meta.json and continue to next site
- Do not abort the entire audit for a single site failure
- Report partial results with clear indication of which sites succeeded/failed

#### Data Safety
- Do not store or log any credentials
- Do not capture or reference any PII from target sites
- Evidence files are local only — never upload to external services
