# Framework Guardrails

This document consolidates all safety rules, execution modes, and constraints for the Playwright Phased Runner framework. Reference this file from skills, commands, and agents via anchor links.

---

## Quick Reference Table

| Mode | Writes Files | Runs Tests | Modifies Code | Use Case |
|------|-------------|------------|---------------|----------|
| FINDINGS_ONLY | No | No | No | Observe and document only |
| RUN_ONLY | Reports only | Yes | No | Execute tests, report results |
| REVIEW_ONLY | Reports only | No | No | Analyze existing artifacts |
| PATCH_ALLOWED | Yes (minimal) | Optional | Yes (scoped) | Apply targeted fixes |
| COORDINATOR | Delegates | Delegates | Delegates | Orchestrate sub-workflows |
| REPO_HYGIENE | Yes (docs) | No | No (no logic) | File moves, archives, references |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Observe and document without making any changes
- **Allowed:** Read files, analyze evidence, generate findings in chat
- **Forbidden:** Write any files, run tests, modify code, apply patches
- **Use when:** Browser walkthroughs, locator validation, exploratory analysis

### RUN_ONLY
- **Purpose:** Execute tests and report results without applying fixes
- **Allowed:** Run test execution, write run reports/summaries, generate evidence
- **Forbidden:** Modify testcase files, change locator maps, fix code
- **Use when:** Parallel test runs, re-verification runs, regression testing

### REVIEW_ONLY
- **Purpose:** Read existing artifacts and produce analysis reports
- **Allowed:** Read all evidence/exports/payloads, write analysis reports
- **Forbidden:** Run tests, modify any files except designated report outputs
- **Use when:** Payload analysis, anomaly indexing, developer packet generation

### PATCH_ALLOWED
- **Purpose:** Make minimal, targeted modifications to resolve issues
- **Allowed:** Edit testcase files, update locator maps, fix identities
- **Forbidden:** Large refactors, unrelated changes, code outside testcase scope
- **Constraints:**
  - Changes must be minimal and scoped to the identified issue
  - Each change must have a clear justification
  - No "drive-by" fixes or style improvements
- **Use when:** Implementing fixes, updating expectations, intake scaffolding

### COORDINATOR
- **Purpose:** Orchestrate multiple sub-workflows without direct execution
- **Allowed:** Delegate to other prompts/skills, synthesize sub-results
- **Forbidden:** Direct file operations (delegated agents handle those)
- **Use when:** Iteration loops, multi-phase workflows

### REPO_HYGIENE
- **Purpose:** Improve repository navigation and organization
- **Allowed:** Move files, create archives, leave deprecation stubs, update references
- **Forbidden:** Modify runner logic, change test execution code, alter evidence
- **Use when:** Navigation cleanup, deprecation passes, file reorganization

---

## 2. Observational Reporting {#observational-reporting}

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Field X has value Y"
- Describe what you expected: "Expected: CRM record created. Observed: No CRM record found."
- Cite evidence with file paths: "Error log shows: [exact message] at `evidence/error.log:17`"
- Ask clarifying questions: "Is this field length intentional?"
- Quantify discrepancies: "Sent: 253 chars. API rejected with: 'max length 100'"
- Compare runs: "run_0006 succeeded with field absent; run_0009 failed with field present"
- Posit hypotheses (labeled): "HYPOTHESIS: The 253-char value may exceed the CRM's 100-char limit"

### What NOT to do:
- Do NOT diagnose root causes — Don't say "The problem is X causes Y"
- Do NOT suggest code implementations — No PHP functions, SQL queries, or algorithms
- Do NOT prescribe solutions — No "Implement compact format" or "Add timestamp fields"
- Do NOT make architecture decisions — No "Use Option B (recommended)"
- Do NOT estimate fix times — No "This will take 4-6 hours"

### Forbidden Labels and Patterns {#forbidden-labels}

Reports must contain **ZERO** instances of:

| Forbidden | Replace With |
|-----------|-------------|
| `Root Cause:` | `Observation:` + `HYPOTHESIS:` |
| `Diagnosis:` | `Observation:` + `HYPOTHESIS:` |
| `Recommendation:` | `Open Questions for Developer Context` |
| `Recommendations for [Name]:` | `Open Questions for Developer Context` |
| `Action Required:` | `Evidence Locations:` |
| `Next Steps for [Name]:` | `Evidence Locations:` |
| `Confidence Level: HIGH` | Remove entirely — let evidence speak |
| `Confidence Level: VERY HIGH` | Remove entirely |
| Priority labels (`P0`, `P1`, `P2`) | Remove entirely — developer assigns priority |
| Code snippets | Remove entirely |
| Implementation suggestions | Remove entirely |
| Time estimates | Remove entirely |

### Required Labels {#required-labels}

All interpretive statements MUST use one of:

- `**Observation:**` — Factual description of what was seen
- `**HYPOTHESIS:**` — Labeled interpretation with evidence path citation
- `**Cross-Run Pattern:**` — Factual comparison across runs
- `**Open Questions for Developer Context:**` — Section header for questions
- `**Evidence Locations:**` — Section header listing file paths

### Example: WRONG vs CORRECT

**WRONG (prescriptive):**
```markdown
**Root Cause:** The attributionpath field exceeds the 100-char limit.

**Recommendations:**
1. Truncate attributionpath to 100 chars
2. Implement compact format: "source1->source2"

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

### Why Observational Reporting Matters

1. **Limited context** — The LLM lacks full codebase architecture, constraints, and roadmap
2. **Observations are facts, hypotheses are testable** — Developer uses them as starting points
3. **Better handoff** — Developer can provide context the LLM doesn't have
4. **Respects expertise** — The developer is the expert, not the test automation

---

## 3. Execution Protocols {#execution-protocols}

### Step Type Markers

| Marker | Meaning | Behavior |
|--------|---------|----------|
| `[AUTO]` | Autonomous execution | Execute without confirmation, report progress |
| `[USER]` | User interaction required | Present question, STOP, wait for response |
| `[GATE: condition]` | Conditional checkpoint | If condition TRUE -> behave as [USER]; if FALSE -> proceed as [AUTO] |

### Gate Constraints

- **Write Block:** When a GATE step triggers (condition TRUE), you MUST NOT write any files containing the gate's subject matter until the gate resolves
- **Stakeholder Gate:** No bundle creation, no QUESTIONS_FOR_DEVELOPER.md until user responds or explicitly invokes fallback

### Sequential Execution

- Execute steps in strict order
- Do not skip or parallelize unless explicitly allowed
- Do not read files or prepare outputs for future steps (no speculation)

---

## 4. File Modification Rules {#file-modification-rules}

### Testcase Files (PATCH_ALLOWED mode only)
- `locator_map.json` — Update selectors when elements change
- `identity.json` — Update email templates, tokens
- `testcase.json` — Update configuration when needed
- `EXPECTED_OUTCOMES.md` — Update expectations based on verified changes

### Evidence Files (Never modify)
- `evidence/` — Screenshots, logs, captures are immutable
- `cookies/` — Cookie snapshots are immutable
- `network/` — Network captures are immutable
- `run.meta.json` — Run metadata is immutable after creation

### Report Outputs (REVIEW_ONLY, PATCH_ALLOWED modes)
- `derived/*.md` — Environment and runset reports
- `reports/` — Canonical payload reports
- `dev_handoff/` — Handoff bundles and indexes

### Raw Artifacts (Copy only, never rewrite)
- Payload JSONs -> Copy verbatim into bundles
- CSV exports -> Copy verbatim into bundles
- Dev changelogs -> Copy to canonical location

---

## 5. Evidence Standards {#evidence-standards}

### Citation Format
- Every factual claim should be backed by an evidence path
- Format: `[description] at \`path/to/file:line\``
- Example: "API error logged at `evidence/A-logged_out/derived/error.log:17`"

### Uncertainty Labels
- `FACT` — Directly observed in evidence
- `HYPOTHESIS` — Interpretation based on evidence
- `UNKNOWN` — Cannot be determined from available evidence

### Excerpt Policy
- Keep excerpts short
- Prefer file paths over pasting logs
- Use line numbers when referencing specific content

### Evidence Source Hierarchy

When asserting pipeline state, use sources in this order (most → least authoritative):

1. **Sync-log payload** — what the site actually sent; ground truth of transmission
2. **Final CRM/destination table** — the business-facing record
3. **Staging/intermediate table** — a holding area; records here may be stuck or unpromoted
4. **Raw exports** — point-in-time snapshots; currency must be verified
5. **Derived statistics** — computed counts and rates; least authoritative

**Never conclude "missing from CRM" from the staging/intermediate table alone.** Staging ≠ final CRM.

**Currency-check before claiming a defect is "live":** compare the codebase's latest change date to the evidence date, and bound all data claims to the export timestamp.

---

## 6. Subagent Rules {#subagent-rules}

### Delegation Language
> **Subagent delegation (optional):** If your environment supports subagents, delegate the sub-tasks listed below in parallel. Otherwise, execute them sequentially in the order listed. Subagents must follow the same guardrails and evidence rules as the parent prompt.

### Standard Subagent Roles
| Role | Purpose |
|------|---------|
| Cookies Scan | Read cookie snapshots (P0-P5), compare across phases and envs |
| dataLayer Scan | Read dataLayer event exports, verify expected events fired |
| Console/Network Scan | Read console logs and network captures, flag errors |
| Exports/Payload Compare | Parse WPForms CSV, CRM CSV, sent payload JSON; match rows by email |
| Cross-env Synthesis | Compare results across A/B/C; identify env-specific vs shared issues |
| Evidence Scan | Extract pass/fail status per env, key artifacts from runset folders |

### Subagent Constraints
- Each subagent receives only the files it needs (narrow scope)
- Subagents must not propose or apply fixes (unless parent mode is PATCH_ALLOWED)
- Subagents must reference evidence paths correctly
- The manager/parent verifies subagent outputs before integrating
- Terminate workers on verified return — do not leave idle background sessions accumulating after their delegated work is complete

---

## 7. Data Safety {#data-safety}

### Never Include
- Real PII (names, addresses, phone numbers of real people)
- Secrets (API keys, passwords, tokens)
- Auth cookies/tokens (describe generically if needed)
- Production credentials

### Safe Patterns
- Use test email addresses (e.g., `test.a.logged_out@example.com`)
- Use placeholder values for sensitive fields
- Reference evidence paths instead of pasting sensitive content

### PII Handling for Joins
- Join records on hashed or pseudonymous keys only (never on raw email, name, phone, or other identifiers)
- Report field presence and format only — never report actual field values in analysis outputs
- Never send raw PII to an external model

---

## 8. Common Pitfalls {#common-pitfalls}

### Pitfall: Prescriptive Reporting
**Wrong:** "The root cause is X. Recommendation: Implement Y."
**Right:** "Observation: X was observed. HYPOTHESIS: This may relate to Y. Open Question: Is Y the intended behavior?"

### Pitfall: Bypassing Gates
**Wrong:** Writing QUESTIONS_FOR_DEVELOPER.md before stakeholder responds
**Right:** Present questions IN CHAT, wait for response, THEN write files

### Pitfall: Over-Fixing
**Wrong:** Fixing multiple unrelated issues while addressing one failure
**Right:** Fix only the specific issue identified, defer other issues

### Pitfall: Speculative Reads
**Wrong:** Reading files for "future steps" before reaching that step
**Right:** Read files only when the current step requires them

### Pitfall: Missing Evidence Paths
**Wrong:** "The field was too long" (no citation)
**Right:** "The field contained 253 chars (evidence: `raw/sent_payload.json:42`)"

---

## 9. Mode-Specific Checklists {#mode-checklists}

### FINDINGS_ONLY Checklist
- [ ] No files were written
- [ ] No tests were executed
- [ ] All findings presented in chat
- [ ] Evidence paths cited for all claims

### RUN_ONLY Checklist
- [ ] Tests executed as configured
- [ ] Run reports written to correct locations
- [ ] No testcase files modified
- [ ] No fix attempts made

### REVIEW_ONLY Checklist
- [ ] Only existing artifacts were read
- [ ] Analysis reports written to designated outputs
- [ ] No tests executed
- [ ] No source files modified

### PATCH_ALLOWED Checklist
- [ ] Changes are minimal and scoped
- [ ] Each change has clear justification
- [ ] No unrelated "drive-by" fixes
- [ ] Changes presented for review before finalizing

### COORDINATOR Checklist
- [ ] Sub-workflows delegated appropriately
- [ ] Results synthesized from sub-agents
- [ ] No direct file operations (delegated)
- [ ] Guardrails enforced in delegated tasks

### REPO_HYGIENE Checklist
- [ ] No runner/test logic modified
- [ ] Archives created with date stamps
- [ ] Deprecation stubs left at old paths
- [ ] All references updated to canonical paths
- [ ] No evidence files touched
