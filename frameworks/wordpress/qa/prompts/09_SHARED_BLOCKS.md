# 09 — Shared Blocks (Rules + Templates)

> **Type**: Reference (not executable)
> **Purpose**: Single source of truth for repeated rules, input names, report templates, and shared blocks referenced by all other prompts.

Use this file as the single source of truth for repeated rules, input names, and lightweight report templates.

---

## A) Standard Inputs (use these names)

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`: folder key under `playwright_phased_runner/testcases/`
- `RUNSET_ID`: allocator-created id (e.g. `run_0006`)
- `ENV`: environment id used by the framework CLI (e.g. `A-logged_out`, `B-logged_in`, `C-incognito`)
- `GOAL`: plain-language description of what the test should prove
- `TAGS`: optional CSV string (e.g. `smoke,release-2026-01-27`)
- Optional: `REFERENCE_RUNSET_ID` (when rerunning or comparing)

If extra context is needed (site/era/base urls), put it under an **Optional Context** header and keep it out of “Standard Inputs”.

---

## B) Operating Rules

### Safety + data rules
- Do not include secrets or real PII.
- Do not paste auth cookies/tokens. If you must reference them, describe generically.

### Execution modes
- `FINDINGS_ONLY`: no code changes, no patches, no reruns.
- `RUN_ONLY`: run once and report; no fixes.
- `REVIEW_ONLY`: read existing artifacts and write reports; no runs, no fixes.
- `PATCH_ALLOWED`: repo changes allowed; keep changes minimal and scoped.

### Evidence rules
- Every factual claim should be backed by an evidence path (file path).
- Label uncertainty clearly: `FACT` / `HYPOTHESIS` / `UNKNOWN` (inline is fine).
- Keep excerpts short; prefer file paths over pasting logs.

---

## C) Report templates (lightweight)

### 1) Per-env env.report.md (co-located with the run)

Write to:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/<ENV>/derived/env.report.md`

Template:
- testcase: `<TESTCASE_ID>`
- runset_id: `<RUNSET_ID>`
- env: `<ENV>`
- status: `PASS | FAIL | PREFLIGHT_FAIL`
- submit.success: `true|false|unknown`

If FAIL:
- first symptom (FACT):
- phase (FACT/UNKNOWN):
- likely category: `auth/storage | selector | timing/wait | navigation/redirect | validation | backend | unknown`
- top evidence:
  - `derived/run.summary.json`
  - `evidence/run.error.json` (if present)
  - `evidence/FAILURE.*.page.png` (if present)

Next step:
- one of: “run MCP walkthrough (05)” / “implement fixes (07)” / “rerun verify (08)” with one sentence why.

### 2) Runset manager report (co-located with the runset)

Write to:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/runset.manager_report.md`

Required sections:
- metadata table (project_root/testcase_id/runset_id/envs/tags/generated_at)
- results table:
  - `env | status | run folder | submit.success | primary failure reason | key evidence paths`
- Observation / HYPOTHESIS synthesis (one shared cross-run pattern if applicable)
- what to do next (prompt references)

---

## D) Naming conventions (recommended)

- Walkthrough findings:
  `playwright_phased_runner/testcases/<TESTCASE_ID>/walkthrough_findings/WALKTHROUGH__<TESTCASE_ID>__<ENV>__iter-<NN>__<YYYY-MM-DDThhmmssZ>.md`
- Export compares:
  `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/compare__<RUNSET_ID>__...__<YYYY-MM-DDThhmmssZ>.md`

---

## E) Observational Reporting Philosophy

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Field X has value Y"
- Describe what you expected: "Expected: CRM record created. Observed: No CRM record found."
- Cite evidence with file paths: "Error log shows: [exact error message] at `evidence/error.log:17`"
- Ask clarifying questions: "Is this field length intentional?"
- Quantify discrepancies: "Sent: 253 chars. API rejected with: 'max length 100'"
- Compare runs: "run_0006 succeeded with field absent; run_0009 failed with field present"
- Posit hypotheses (labeled): "HYPOTHESIS: The 253-char value may exceed the CRM field's 100-char limit, based on the API rejection at `[path]`."

### What NOT to do:
- Do NOT diagnose root causes — Don't say "The problem is X causes Y"; posit a labeled HYPOTHESIS instead
- Do NOT suggest code implementations — No PHP functions, SQL queries, or algorithm designs
- Do NOT prescribe solutions — No "Implement compact format" or "Add timestamp fields"
- Do NOT make architecture decisions — No "Use Option B (recommended)"
- Do NOT estimate fix times — No "This will take 4-6 hours"

### Forbidden labels and patterns (explicit blocklist):
Reports must contain ZERO instances of:
- `Root Cause:` or `Diagnosis:` — use `Observation:` + `HYPOTHESIS:` instead
- `Recommendation:` or `Recommendations for [Name]:` — use `Open Questions for Developer Context` instead
- `Action Required:` or `Next Steps for [Name]:` — use `Evidence Locations:` instead
- `Confidence Level: HIGH` or `VERY HIGH` — remove entirely; let evidence speak for itself
- Priority labels (`P0`, `P1`, `P2`) — remove entirely; developer assigns priority
- Code snippets or implementation suggestions — remove entirely
- Time estimates (`4-6 hours`, `quick fix`) — remove entirely

### Required patterns (explicit allowlist):
All interpretive statements MUST use one of:
- `**Observation:**` — factual description of what was seen
- `**HYPOTHESIS:**` — labeled interpretation with evidence path citation
- `**Cross-Run Pattern:**` — factual comparison across runs
- `**Open Questions for Developer Context:**` — section header for questions
- `**Evidence Locations:**` — section header listing file paths

### Example: WRONG vs CORRECT

**WRONG (prescriptive):**
```markdown
**Root Cause:** The attributionpath field exceeds the 100-char limit.

**Recommendations:**
1. Truncate attributionpath to 100 chars
2. Implement compact format: "source1→source2"

**Action Required:** Immediate backend fix
**Confidence Level:** VERY HIGH
```

**CORRECT (observational):**
```markdown
**Observation:** The `{crm_field_prefix}attributionpath` field contained 253 characters.
The CRM API returned error code 0x80044331 citing a maximum length of 100 characters.

**HYPOTHESIS:** The field length (253 chars) exceeds the CRM's 100-char limit, which
may explain the API rejection. Evidence: `raw/error_logs.txt` line 17.

**Open Questions for Developer Context:**
1. What is the intended format for attributionpath?
2. Is the 100-char limit a schema constraint or API validation?

**Evidence Locations:**
- Error logs: `raw/error_logs.txt`
- Sent payload: `raw/run_0009__sent_payload__C.json`
```

### Why:
1. Limited context — The LLM lacks full codebase architecture, constraints, and roadmap knowledge
2. Observations are facts, hypotheses are testable — The developer uses them as starting points
3. Better handoff — Developer can provide context the LLM doesn't have
4. Respects expertise — The developer is the expert, not the test automation

---

## F) Stakeholder Interview Gate

Use this gate in any playbook or analysis prompt when discrepancies exist between expected and observed behavior. The gate **pauses execution** to gather stakeholder context before classifying issues.

### When this gate triggers
Insert the gate between "analysis finds discrepancies" and "issue classification / severity assignment" whenever ANY of these conditions exist:
- Any mismatch between expected and actual field values
- Missing fields in payload, CRM, or WPForms export
- New/unexpected fields appearing in payload or CRM
- Format deltas (phone, date, province, encoding)
- API rejections or backend errors
- Cross-environment inconsistencies (A vs B vs C)
- Fields marked `[NOT YET POPULATED]` in expected outcomes that now have values (or vice versa)

### Gate procedure

1. **Collect observations** — List all discrepancies found during analysis, grouped by category (missing, extra, format, value mismatch, API error, cross-env delta).

2. **Present to stakeholder** — Ask clarifying questions such as:
   - "Field X was empty in all envs — is that expected or a regression?"
   - "Is env B allowed to differ from env A for field Y?"
   - "Should this missing data be treated as regression or known gap?"
   - "Field Z has value `[value]` — is this the intended format?"
   - "CRM rejected field W (253 chars, limit 100) — is this a known constraint?"

3. **Record answers** — Save responses to:
   - For run-level analysis: `<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/derived/stakeholder_answers.md`
   - For bundle-level analysis: `{bundle_path}/raw/stakeholder_answers.md`

   Format:
   ```markdown
   # Stakeholder Answers — {TESTCASE_ID} / {RUNSET_ID}
   **Date:** {date}
   **Stakeholder:** {name or role}

   | # | Observation | Question | Answer | Classification |
   |---|-------------|----------|--------|----------------|
   | 1 | Field X empty | Expected? | "Yes, not mapped yet" | expected — note |
   | 2 | Phone format (xxx) xxx-xxxx | Correct format? | "Should be E.164" | unexpected — issue |
   ```

4. **Apply answers to classification**:
   - Stakeholder confirms "expected" → classify as **NOTE** (document but not an issue)
   - Stakeholder confirms "unexpected" → classify as **ISSUE** with severity
   - Stakeholder is unavailable or unsure → classify as **UNKNOWN** (list as question; do not assume)

### Fallback when stakeholder is unavailable
If the stakeholder cannot be reached:
- Mark all ambiguous discrepancies as `UNKNOWN`
- List them in a "Questions Pending Stakeholder Review" section
- Do NOT assume intent — do not classify UNKNOWN items as either expected or unexpected
- Proceed with analysis but flag that classification is incomplete

---

## G) Subagent Delegation Language

Use this standard language in any prompt that supports subagent delegation:

> **Subagent delegation (optional):** If your environment supports subagents, delegate the sub-tasks listed below in parallel. Otherwise, execute them sequentially in the order listed. Subagents must follow the same guardrails and evidence rules as the parent prompt.

### Standard subagent roles (use when applicable)
- **Cookies Scan** — Read cookie snapshots (P0–P5), compare across phases and envs
- **dataLayer Scan** — Read dataLayer event exports, verify expected events fired
- **Console/Network Scan** — Read console logs and network captures, flag errors
- **Exports/Payload Compare** — Parse WPForms CSV, CRM CSV, sent payload JSON; match rows by email
- **Cross-env Synthesis** — Compare results across A/B/C; identify env-specific vs shared issues
- **Evidence Scan** — Extract pass/fail status per env, key artifacts from runset folders

### Subagent constraints
- Each subagent receives only the files it needs (narrow scope)
- Subagents must not propose or apply fixes (unless the parent prompt mode is PATCH_ALLOWED)
- Subagents must reference evidence paths correctly
- The manager/parent verifies subagent outputs before integrating

---

## H) Reporting Requirements Interview

Use this interview template at the start of any payload/export analysis prompt to capture stakeholder expectations before analysis begins.

### Questions to ask:

**Form behavior**
- Any known popups/modals, conditional pages, or validation quirks to expect?
- Any intentional environment deltas (A/B/C) we should treat as expected?

**Data formatting**
- Phone format expected in payload/CRM (E.164 vs formatted string)?
- Date formats expected (DOB, `createdon`, consent timestamps) and timezone expectations?
- Province/state expected format (full name vs abbreviation)?
- Null/empty conventions (empty string vs `null` vs omitted key) that are acceptable?

**CRM/WPForms matching**
- Primary join key (default: `email`)?
- If multiple CRM rows match, which timestamp field should be used to pick the "correct" row (e.g., `createdon`, consent timestamp, WPForms `date_submitted`)?

**Known gaps / policy**
- Any fields that are known "not yet populated" and should be flagged but not treated as regressions?
- Any field-level constraints (max length, allowed values) or special formatting policies?

### Recording answers
Save the interview answers as part of the analysis context. In handoff bundles, include them in `LLM_MANIFEST.json` under `reporting_expectations`.

---

## I) Per-Run Intake Items (Payload Analysis)

Use these standard intake items when collecting per-run inputs for payload analysis prompts (13, 14).

For **each run item**, collect:

### A) Run identifiers
- `testcase_id` (string; e.g. `full_mapping_t2_happypath`)
- `run_id` (string; e.g. `run_0005`)
- Environments assumed A/B/C unless runset folder contains only a subset.

### B) Run evidence (required; all envs)
- Runset directory path: `playwright_phased_runner/testcases/<testcase_id>/runs/<run_id>/`
- Include all environment subfolders present (A/B/C + retry variants).

### C) WPForms export
- Filepath to the WPForms entries export CSV.
- Match rows per env using env-specific `email` from each env's `run.meta.json`.
- Record `date_submitted` and consent/timestamp fields if present.

### D) CRM export
- Filepath to the CRM export CSV.
- Match by env-specific email from `run.meta.json`.
- If multiple rows match, prefer closest `createdon`/consent timestamp to WPForms `date_submitted`.

### E) Expected payload (keys only matter)
- JSON array of expected payload samples OR filepath to `expected_payload.json`.
- If per-env variants exist: `expected_payload__A.json`, `__B.json`, `__C.json`.
- Record: `expected_payload_keys` = sorted unique top-level keys.

### F) Actual Env A sent payload (source of truth)
- Env A "processed payload / sent to CRM" JSON (paste or filepath).
- Recommended storage: `runs/<run_id>/exports/sent_payload/sent_payload__A.json`
- Only Env A required at intake. Do not block on B/C unless out-of-bounds.

### G) Expected outcomes spec
- Filepath to `EXPECTED_OUTCOMES.md` (testcase-level preferred).

After collecting A–G, confirm resolved paths and ask: "Proceed?"

---

## J) CRM Pipeline Integrity Discipline

This section is the single source of truth for CRM pipeline evidence rules. Prompts 10 and 13 must load this block at preflight before any compare, synthesis, or acceptance-grade output.

### Evidence source hierarchy (most → least authoritative)

1. **Sync-log PAYLOAD** — what the site actually sent; ground truth of transmission
2. **Final CRM/destination table** — the business-facing record; what the business works from
3. **Staging/intermediate table** — a holding area; records here may be stuck or unpromoted; low fill is NOT proof of loss
4. **Raw exports** — point-in-time snapshots; currency must be verified
5. **Derived statistics** — computed counts and rates; least authoritative

**CRITICAL:** Never conclude "missing from CRM" from the staging/intermediate table alone. Staging ≠ final CRM.

### 4-step preflight order (required before any statistics)

① Pull the sync-log payload — ground truth of what was sent.
② Read the final CRM/destination table, not the staging/intermediate table.
③ Currency-check before claiming the defect is live — compare the codebase's latest change date to the evidence date; bound all data claims to the export timestamp before claiming any defect is "live".
④ Distinct-mind verify any acceptance-grade claim — an independent reviewer or second model must confirm before shipping.

### Same-population rule

Never compare rates across two sources without a per-record join on matching keys. The "form submission population" and the "CRM population" are different sets. Aggregate comparisons across mismatched populations are not valid.

### Privacy for joins

- Join on hashed or pseudonymous keys only
- Report presence and format only — never report field values
- Never send raw PII to an external model
