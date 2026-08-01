# 13 — Payload Deep Analysis + {DEVELOPER_NAME} Handoff (Playbook)

> **Type**: Playbook (orchestrator)
> **Mode**: REVIEW_ONLY (no runs, no fixes)

---

## Goal

Produce a developer-friendly handoff bundle (for {DEVELOPER_NAME}) and a canonical "Processed Payload / Sent to CRM" report per run. This prompt loops over multiple testcase runs, comparing expected payload keys, actual sent payload, CRM export, WPForms export, and expected outcomes.

This prompt always creates a **NEW** handoff bundle directory. To append to an existing bundle, use `framework/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md`.

---

## Inputs (paths)

Standard inputs per `09_SHARED_BLOCKS.md` § A, plus per-run items per `09_SHARED_BLOCKS.md` § I:
- Per-run intake items A–G (run identifiers, evidence, WPForms CSV, CRM CSV, expected payload, actual Env A payload, expected outcomes)
- Optional: pre-existing dev changelog file path

---

## Terminology

Key terms used in this prompt (to prevent confusion during analysis):

| Term | Definition |
|------|------------|
| **expected_payload.json** | The test artifact: a JSON file defining what the test EXPECTS to be sent to the CRM. Found at `testcases/{id}/expected_payload.json`. This is the test's "truth" for comparison. |
| **CRM schema** | The actual field definitions in the destination CRM system. Note: the staging/intermediate table (client-specific) is a holding area and is NOT the final CRM table (client-specific). May differ from expected_payload if the schema evolved or expected_payload is stale. |
| **Undocumented field** | A field present in the actual payload but NOT in expected_payload.json. This means the test doesn't know about it—NOT that it's absent from CRM schema. |
| **Missing field** | A field in expected_payload.json that is ABSENT from the actual sent payload. The test expected it, but it wasn't sent. |
| **Extra field** | Synonym for "undocumented field" — present in actual, not in expected. |
| **Value mismatch** | Field exists in both expected and actual, but values differ (beyond known deltas like email/token). |
| **Known delta** | Expected differences between envs (email addresses, test tokens, timestamps). Not anomalies. |
| **dynamics_mappings** | The WPForms-to-CRM field mapping configuration in the form's PHP handler. |

---

## Outputs (paths)

Per run:
- `playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__{testcase_id}__{run_id}__A__{createdon_utc}__for_{DEVELOPER_NAME_LOWER}.md`

Bundle (new directory):
- `playwright_phased_runner/dev_handoff/DEV_HANDOFF__{DEVELOPER_NAME_LOWER}__payload_reporting__{generated_at_utc}/`
  - `llm/LLM_MANIFEST.json` — machine-first manifest (downstream LLMs read first)
  - `llm/AGENTS.md`, `llm/CLAUDE.md`, `llm/.cursorrules` — standalone agent harness
  - `llm/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md`, `llm/prompts/13_...md` — prompt copies
  - `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `LLM_MANIFEST.json` — bundle-root copies (for Cursor-style workflows)
  - `INDEX.md`, `INDEX.json` — artifact indexes
  - `SUMMARY.json` — machine-friendly summary (single-screen, strict JSON)
  - `For_Recipient.md` — lean observational summary (<10 min read)
  - `QUESTIONS_FOR_DEVELOPER.md` — structured developer interview
  - `reports/` — canonical payload reports + deep analysis reports
  - `raw/` — verbatim inputs (payloads, exports, changelog, derived key lists)
  - `evidence/{testcase_id}/{run_id}/...` — full runset evidence copies

Canonical changelog (if provided):
- `playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md`
- `playwright_phased_runner/changelogs/LATEST.txt`

Stakeholder answers (if gate triggered):
- `{bundle_path}/raw/stakeholder_answers.md`

Expectation updates (if changelog triggered updates):
- `{bundle_path}/raw/expectation_update_proposals.md` (proposed updates, not applied in this REVIEW_ONLY playbook)
- Note: applying expectation updates is a separate PATCH_ALLOWED follow-on step

---

## Guardrails

- Per `09_SHARED_BLOCKS.md` § B (Operating Rules) — mode is REVIEW_ONLY.
- Per `09_SHARED_BLOCKS.md` § E (Observational Reporting Philosophy) — all reports must be observational.
- Per `09_SHARED_BLOCKS.md` § J (CRM Pipeline Integrity Discipline) — load and apply before any compare or synthesis: evidence source hierarchy, 4-step preflight order, same-population rule, privacy for joins.
- Framework-first preflight: before writing any handoff file, re-read this prompt and `09_SHARED_BLOCKS.md` § E. The bundle structure, voice, labels, and evidence contract come from the framework prompt, not from an ad hoc client-specific packet shape.
- Do NOT change any code.
- Do NOT rewrite/alter raw artifacts (payload JSON, CSV exports, evidence). Only **copy** them into the bundle.
- Keep reporting concise and scannable; prefer paths over embedding large logs.
- Use stable IDs and tags across artifacts:
  - Observations: `OBS-###` with `[OBS]` tag
  - Hypotheses: `HYP-###` with `[HYPOTHESIS]` tag
  - Questions: `Q-###` with `[QUESTION]` tag
  - Ensure IDs align between `OBSERVATIONS__*.md`, `QUESTIONS_FOR_DEVELOPER.md`, and `SUMMARY.json`.

---

## Delegation Plan (optional subagents)

Per `09_SHARED_BLOCKS.md` § G: If subagents are available, delegate the sub-tasks below in parallel; otherwise run sequentially.

**Per run item:**

| Sub-task | Subagent Role | Inputs | Outputs |
|----------|---------------|--------|---------|
| WPForms export scan | Exports/Payload Compare | WPForms CSV, per-env emails from `run.meta.json` | Matched rows, `date_submitted`, consent fields per env |
| CRM export scan | Exports/Payload Compare | CRM CSV, per-env emails from `run.meta.json` | CRM row existence per env, `createdon`, consent fields |
| Evidence scan | Evidence Scan | Runset evidence folders | Pass/fail status per env, key artifacts (submit result, console, dataLayer) |
| Expectation update | Expectation Updater (PATCH_ALLOWED) | Dev changelog, testcase paths | Updated `EXPECTED_OUTCOMES.md`, `expected_payload.json` per testcase |
| **Manager (you)** | — | Sub-task outputs + expected payload + actual payload | Canonical report, deep analysis, bundle assembly |

---

## Execution Steps

### Pre-Step — Dev Changelog Lookup + Expectation Update

#### A) Changelog Lookup (AUTO — no prompting for content)

**IMPORTANT:** This step only LOOKS UP existing changelogs. It does NOT prompt for or collect changelog content. Changelog creation is the responsibility of `/framework:changelog-capture` (invoked during parallel-run post-fix verification).

1. Check `playwright_phased_runner/changelogs/LATEST.txt`
   - If exists: read the referenced changelog file path
   - Validate the referenced file exists

2. Record changelog_status:
   - `CHANGELOG_AVAILABLE = true`: Changelog file found and valid → include in bundle at `raw/dev_changelog.md`
   - `CHANGELOG_AVAILABLE = false`: No LATEST.txt or referenced file missing → note in For_Recipient.md

3. **Do NOT prompt user for changelog content.**
   - If changelog is absent, add to For_Recipient.md:
     ```
     **Changelog Status:** Not available at bundle creation time.
     If fixes were made, run `/framework:changelog-capture` to document changes.
     ```

4. Proceed to Expectation Update (if changelog available) or Step 0.

#### B) Expectation Update (if changelog available)

**Trigger:** `CHANGELOG_AVAILABLE = true` AND changelog contains "Behavioral changes" or "Data format/mapping changes" sections with content.

**In this REVIEW_ONLY playbook:**
1. Parse changelog "Behavioral changes" section → identify proposed updates to `EXPECTED_OUTCOMES.md`
2. Parse changelog "Data format/mapping changes" section → identify proposed updates to `expected_payload.json`
3. For each proposed change:
   - Show: field/section, old value, new value, changelog evidence
4. Write proposed updates to `{bundle_path}/raw/expectation_update_proposals.md` (not applied in this playbook)
5. Explicitly note: "Applying these expectation updates is a separate PATCH_ALLOWED follow-on step"
6. Return summary of proposed changes (or "no updates needed")

**On completion:**
   - Proceed with comparison using EXISTING expectations (unchanged)
   - Include `expectation_update_proposals.md` in bundle `raw/` in Step 3
   - Note in For_Recipient.md: "Expectation updates proposed (not applied) — review and apply separately if confirmed"

**Skip condition:** If `CHANGELOG_AVAILABLE = false` or changelog has no behavioral/format changes, skip directly to Step 0.

### Step 0 — Intake Loop

1. Ask: "How many runs are we reporting on?" (or "one at a time — reply `done` when finished").
2. Run the **Reporting Requirements Interview** per `09_SHARED_BLOCKS.md` § H.
3. For each run item, collect **Per-Run Intake Items** per `09_SHARED_BLOCKS.md` § I (items A–G).
4. Confirm resolved paths. Ask: "Proceed?"

### Step 1 — Create Canonical Payload Report (per run)

Create: `playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__{testcase_id}__{run_id}__A__{createdon_utc}__for_{DEVELOPER_NAME_LOWER}.md`

Sections (in order):
1. `# Processed Payload / Sent to CRM`
2. `## Run identity` — infer from actual payload: env, createdon, email, name, t_score, leadvalue, landing_page
3. `## Payload (raw JSON)` — exact JSON in fenced code block, no edits
4. `## Key fields (human readable)` — bullets grouped: Identity, Vehicle/Finance, Address, Attribution, Consent, Meta
5. `## Notes / anomalies` — encoding, escaped JSON, date formats, phone normalization, type mismatches, missing fields

### Step 1a — Cross-Form Field Mapping Check (GATE: multiple WPForms IDs)

**Trigger:** Multiple WPForms IDs are involved across the runs being analyzed.

If the runs span multiple WPForms IDs (different forms):

1. **Extract dynamics_mappings per form:**
   - For each unique WPForms ID, identify the field mappings used
   - Look for mapping config in evidence or testcase metadata

2. **Compare mappings across forms:**
   | Field | Form A (ID: xxx) | Form B (ID: yyy) | Status |
   |-------|------------------|------------------|--------|
   | first_name | field_12 → {crm_field_prefix}firstname | field_45 → {crm_field_prefix}firstname | MATCH |
   | custom_field | field_145 → {crm_field_prefix}createdon | NOT MAPPED | DISCREPANCY |

3. **Flag discrepancies:**
   - Fields mapped in one form but not another
   - Same WPForms field ID mapping to different CRM fields
   - Different normalization rules per form

4. **Add to question inventory for Stakeholder Gate:**
   - "Form ID xxx maps field 145 to createdon, but form ID yyy does not map this field. Is this intentional?"

If only one WPForms ID is involved, skip this step.

### Step 2 — Deep Analysis (per run)

Create a detailed analysis report (stored in bundle `reports/`), covering:

**A) Expected vs actual payload keys:**
- Missing keys (in expected but not actual)
- Extra keys (in actual but not expected)
- Value comparisons for shared keys (minimal normalization for comparison only)

**B) Expected outcomes vs evidence:**
- Submission success criteria met?
- dataLayer events fired with correct values?
- Console log markers present?
- CRM export contains matching row per env (A/B/C)?
- WPForms export contains matching submission?

**C) High-signal anomalies:**
- Mapping bugs, normalization bugs, attribution gaps, pipeline mismatches
- All observations must be evidence-driven with file path citations

**D) Missing-input detection:**
- Whether B/C environments exist in runset
- Whether CRM export contains B/C rows
- Whether B/C sent payloads are needed

### Step 2a — Pre-Gate Question Inventory

Before proceeding to the Stakeholder Gate, enumerate ALL questions/discrepancies discovered and format them for direct presentation.

**Mandatory categories to check:**
1. Value mismatches (expected vs actual payload)
2. Missing fields (in expected but not actual, or vice versa)
3. Format deltas (date formats, phone normalization, encoding differences)
4. API errors or rejections observed in evidence
5. Cross-env inconsistencies (A vs B vs C differences not explained by known deltas)
6. Expectation gaps (EXPECTED_OUTCOMES.md ambiguities or missing specs)
7. Architecture ambiguities (unclear field ownership, unknown constraints)
8. Cross-form mapping discrepancies (from Step 1a, if applicable)

**Output to chat — FULL NUMBERED LIST with evidence paths:**

```
══════════════════════════════════════════════════════════════
PRE-GATE QUESTION INVENTORY — [TOTAL] items requiring clarification
══════════════════════════════════════════════════════════════

1. [VALUE_MISMATCH] Field: {crm_field_prefix}phone
   Expected: "(902) 555-1234"
   Actual: "9025551234"
   Evidence: raw/expected_payload.json:42, raw/sent_payload__A.json:38
   Question: Is this normalization (stripping formatting) intentional?

2. [MISSING_FIELD] Field: {crm_field_prefix}consent_timestamp
   Present in expected_payload.json but ABSENT from sent payload.
   Evidence: raw/expected_payload.json:67
   Question: Should this field be populated? Is it optional?

[...continue for all items...]

══════════════════════════════════════════════════════════════
TOTAL_QUESTIONS: [N]
GATE_TRIGGERS: [YES if N > 0, NO otherwise]
══════════════════════════════════════════════════════════════
```

**Critical:** This numbered list IS the format for Step 2b. Do not re-enumerate.

If TOTAL_QUESTIONS = 0: Proceed directly to Step 3 (skip Step 2b).
If TOTAL_QUESTIONS > 0: Step 2b gate is ACTIVE — present this list and wait for answers.

### Step 2b — Stakeholder Interview Gate (GATE: TOTAL_QUESTIONS > 0)

Per `09_SHARED_BLOCKS.md` § F.

```
▶▶▶ STAKEHOLDER GATE ACTIVE — AWAITING USER RESPONSE ◀◀◀
```

**CRITICAL CONSTRAINTS:**
- Do NOT create the bundle directory yet
- Do NOT write QUESTIONS_FOR_DEVELOPER.md yet
- Do NOT write any bundle files until this gate resolves

**Required output format (IN CHAT, not file):**

The numbered list from Step 2a is already displayed. Add answer slots:

```
══════════════════════════════════════════════════════════════
STAKEHOLDER GATE — [TOTAL_QUESTIONS] questions require clarification
══════════════════════════════════════════════════════════════

Please provide answers using the format: "1: yes, 2: intentional, 3: not sure"

1. [VALUE_MISMATCH] {crm_field_prefix}phone normalization
   → Answer: _____

2. [MISSING_FIELD] {crm_field_prefix}consent_timestamp absent
   → Answer: _____

[...continue for all items...]

══════════════════════════════════════════════════════════════
RESPONSE OPTIONS:
- Answer inline: "1: yes it's intentional, 2: bug, 3: skip"
- "skip" — proceed without answers (items marked UNKNOWN)
- "skip 2,4,5" — answer some, skip specific items
══════════════════════════════════════════════════════════════
```

**STOP AND WAIT FOR USER RESPONSE. DO NOT PROCEED.**

**After user responds:**
1. Parse user's answers (handle formats: "1: yes", "1=yes", "1. yes", numbered list)
2. Record to `{bundle_path}/raw/stakeholder_answers.md` (create bundle dir now)
3. Apply categorization:
   - User confirmed expected behavior → NOTE (not an issue)
   - User confirmed unexpected behavior → ISSUE (needs dev attention)
   - User said "don't know", "skip", or no answer → UNKNOWN (forward to dev)
4. Proceed to Step 3

**Fallback (user explicitly invokes skip):**
Only if user explicitly says "skip", "can't answer", or "proceed without":
- Create stakeholder_answers.md with all items as UNKNOWN
- Note in For_Recipient.md: "Stakeholder gate skipped — all questions marked UNKNOWN"
- Proceed to Step 3

### Step 3 — Build {DEVELOPER_NAME} Handoff Bundle

Create: `playwright_phased_runner/dev_handoff/DEV_HANDOFF__{DEVELOPER_NAME_LOWER}__payload_reporting__{generated_at_utc}/`

Before writing the bundle:

- Confirm the target handoff is being produced from this framework prompt, not from a freehand report outline.
- Keep all client-specific facts in the project bundle only. Do not copy client names, URLs, field values, lead data, or local evidence paths into framework files.
- Use the framework's observational labels (`Observation`, `HYPOTHESIS`, `Open Questions for Review`, `Evidence Locations`) in `For_Recipient.md` and `QUESTIONS_FOR_DEVELOPER.md`.
- If a prior handoff exists with a different structure, treat it as source material and normalize into the framework structure rather than preserving the old shape.

Assemble the following (see Outputs section above for full list):

0. `llm/LLM_MANIFEST.json` — include: bundle_version, required_prompts, reporting_expectations, required_inputs_present, canonical_changelog_path, changelog_status, changelog_workflow, open_first[], runs[]
0a. `llm/` standalone agent harness: copy repo `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and prompt texts for 13 and 16
0b. Bundle-root copies: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `LLM_MANIFEST.json`
1. `INDEX.md` — per-run: testcase_id, run_id, env, email, createdon, paths to reports/raw
2. `INDEX.json` — stable-order array: kind, testcase_id, run_id, env, path, description
3. `For_Recipient.md` — lean, observational: what's working, what's broken, key observations, questions, evidence paths. Top "Open first" bullets: `llm/LLM_MANIFEST.json`, `SUMMARY.json`, `raw/dev_changelog.md`
4. `QUESTIONS_FOR_DEVELOPER.md` — structured interview template (purpose, observations summary, questions by category, evidence paths, how to respond). This file is the authoritative list of questions.
5. `SUMMARY.json` — strict JSON with: bundle_id, created, status, runs[], key_findings[], open_questions[], known_issues[], evidence_paths. Keep it small and machine-friendly.
5. `reports/` — canonical payload reports + deep analysis reports
6. `raw/` — dev_changelog.md, dev_changelog.checklist.json, expected payloads, actual payloads, CSV exports
7. `evidence/` — full runset directory copies (all env folders)

### Step 4 — Loop / Finalize

- After each run item: "Add another run? If yes, provide next identifiers. If no, reply `done`."
- When finished: ensure INDEX.md, INDEX.json, For_Recipient.md summarize ALL included runs with stable ordering, and SUMMARY.json is consistent with QUESTIONS_FOR_DEVELOPER.md.
- Ensure every report references paths to raw evidence within the bundle.

### Step 4a — Unresolved Items Handoff

Document items that were discussed in the Stakeholder Gate but not fully resolved.

For any item from Step 2b where:
- User answered "don't know" or "not sure"
- User skipped the item
- Answer was ambiguous or required dev expertise

Add a dedicated section to QUESTIONS_FOR_DEVELOPER.md:

```markdown
## Items Requiring Developer Clarification

The following items were discussed with the stakeholder but could not be fully resolved
without developer context. These are forwarded for your attention.

### 1. [CATEGORY] [Brief description]

**Observation:** [What was observed]

**Stakeholder Response:** [What user said, or "Skipped"]

**Why this needs dev context:** [Why stakeholder couldn't resolve]

**Evidence:** [File paths]

---

### 2. [Next item...]
```

**Transparency note:** This step ensures nothing "falls through the cracks" between
stakeholder interview and developer handoff. Items are explicitly flagged rather than
silently included as UNKNOWN in a table.

If no unresolved items exist (all questions answered definitively), skip this section.

---

## Acceptance Criteria

- [ ] Every run has a canonical payload report in `playwright_phased_runner/reports/`
- [ ] **Currency gate:** Findings verified against the current repository HEAD before shipping. Evidence sourced from an older clone may already be fixed — run `runner/check-currency.cjs --repo <git-dir> --evidence-date <ISO>` and record the verdict in the bundle. If evidence is STALE, note explicitly which findings may already be resolved.
- [ ] **RESOLVED classification:** Each finding is classified as either OPEN (needs attention) or RESOLVED (already fixed — no action needed). RESOLVED items must be listed as resolved, not silently omitted and not shipped as open issues.
- [ ] Framework-first preflight completed before bundle authoring
- [ ] Bundle directory exists with all required files (LLM_MANIFEST.json, indexes, For_Recipient.md, QUESTIONS_FOR_DEVELOPER.md, reports/, raw/, evidence/)
- [ ] SUMMARY.json present and consistent with QUESTIONS_FOR_DEVELOPER.md
- [ ] Bundle-root harness files present (AGENTS.md, CLAUDE.md, .cursorrules, LLM_MANIFEST.json)
- [ ] All evidence paths referenced in reports are valid (files exist in bundle)
- [ ] INDEX.json has stable ordering and correct relative paths
- [ ] Changelog lookup (Pre-Step A) executed as AUTO — no prompting for content
- [ ] If multiple WPForms IDs: cross-form mapping check (Step 1a) executed
- [ ] Pre-gate question inventory (Step 2a) output to chat with FULL numbered list and evidence paths
- [ ] If TOTAL_QUESTIONS > 0: checkpoint marker `▶▶▶ STAKEHOLDER GATE ACTIVE` was output
- [ ] If TOTAL_QUESTIONS > 0: questions presented IN CHAT with inline answer slots (→ Answer: _____)
- [ ] If TOTAL_QUESTIONS > 0: stakeholder_answers.md written only AFTER user responded (not before)
- [ ] Stakeholder Interview Gate was run (or stakeholder unavailable fallback applied) when discrepancies exist
- [ ] Stakeholder answers recorded in `raw/stakeholder_answers.md` (if gate triggered)
- [ ] Unresolved items (Step 4a) explicitly documented with stakeholder response and dev context note
- [ ] Changelog status documented in LLM_MANIFEST.json
- [ ] For_Recipient.md is <10 minute read
- [ ] Observational reporting philosophy followed (no diagnoses, no solutions, no time estimates)
- [ ] If changelog contained behavioral/format changes, Expectation Updater subagent was invoked
- [ ] Expectation updates were confirmed with user before applying
- [ ] `raw/expectation_update_summary.md` documents any expectation changes made (or notes "no updates needed")

---

## Failure Modes / Escalation

| Condition | Action |
|-----------|--------|
| Evidence directory missing or empty | Flag as BLOCKING; ask user for correct path; do not fabricate evidence |
| WPForms CSV not provided | Proceed without; note gap in report; CRM-only analysis |
| CRM CSV not provided | Proceed without; note gap; payload-only analysis |
| Expected payload not provided | Ask user — this is required for key comparison |
| Actual Env A payload not provided | BLOCKING — cannot proceed without source of truth |
| Stakeholder unavailable for gate | Use fallback: mark discrepancies UNKNOWN, list as questions |
| Runset has no B/C envs | Note in report; analyze A only; flag if CRM has B/C rows |
| Multiple CRM rows match single email | Pick by closest timestamp; document selection criteria |
| Changelog not available and codebase changed | Note in For_Recipient.md; bundle harness files instruct dev to generate post-fix |
| Changelog has changes but testcase paths invalid | Ask user for correct testcase paths; do not guess |
| User declines all expectation updates | Proceed with original expectations; note in report that updates were declined |
| Expectation Updater subagent fails | Fall back to manual: list proposed changes in For_Recipient.md for manual update |
