# 14 — Append Payload Reporting to Existing Handoff Bundle (Playbook)

> **Type**: Playbook (orchestrator)
> **Mode**: REVIEW_ONLY (no runs, no fixes); delegates PATCH_ALLOWED to Expectation Updater subagent

---

## Goal

Append one or more testcase runs into an **existing** payload-reporting handoff bundle, updating bundle indexes and the lean `For_Recipient.md` summary.

Use this prompt when you already have a bundle at `playwright_phased_runner/dev_handoff/DEV_HANDOFF__{DEVELOPER_NAME_LOWER}__payload_reporting__.../` and want to add more runs without creating a new bundle.

To create a new bundle, use `framework/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md`.

---

## Inputs (paths)

- `EXISTING_BUNDLE_PATH`: path to the existing handoff bundle directory
- `OVERWRITE_POLICY`: `false` (default) — do not overwrite existing run folders; `true` — allow
- Standard inputs per `09_SHARED_BLOCKS.md` § A
- Per-run intake items per `09_SHARED_BLOCKS.md` § I (items A–G)
- Optional: pre-existing dev changelog file path

---

## Outputs (paths)

Per run (new):
- `playwright_phased_runner/reports/PROCESSED_PAYLOAD_SENT_TO_CRM__{testcase_id}__{run_id}__A__{createdon_utc}__for_{DEVELOPER_NAME_LOWER}.md`

Updated bundle files:
- `{bundle}/llm/LLM_MANIFEST.json` (updated)
- `{bundle}/INDEX.md`, `{bundle}/INDEX.json` (appended)
- `{bundle}/SUMMARY.json` (updated)
- `{bundle}/For_Recipient.md` (updated with new run sections)
- `{bundle}/QUESTIONS_FOR_DEVELOPER.md` (updated)
- `{bundle}/reports/` (new reports added)
- `{bundle}/raw/` (new inputs added; dev_changelog.md if newly collected)
- `{bundle}/evidence/{testcase_id}/{run_id}/...` (new evidence copies)

Stakeholder answers (if gate triggered):
- `{bundle}/raw/stakeholder_answers.md`

---

## Guardrails

- Per `09_SHARED_BLOCKS.md` § B (Operating Rules) — mode is REVIEW_ONLY.
- Per `09_SHARED_BLOCKS.md` § E (Observational Reporting Philosophy) — all reports must be observational.
- Do NOT change any code.
- Do NOT rewrite/alter raw artifacts. Only **copy** them into the bundle.
- Avoid overwriting existing run folders unless user explicitly sets `overwrite=true`.
- Keep reporting concise; prefer paths over embedded logs.
- Use stable IDs and tags across artifacts:
  - Observations: `OBS-###` with `[OBS]` tag
  - Hypotheses: `HYP-###` with `[HYPOTHESIS]` tag
  - Questions: `Q-###` with `[QUESTION]` tag
  - Ensure IDs align between `OBSERVATIONS__*.md`, `QUESTIONS_FOR_DEVELOPER.md`, and `SUMMARY.json`.

---

## Delegation Plan (optional subagents)

Per `09_SHARED_BLOCKS.md` § G: If subagents are available, delegate in parallel; otherwise run sequentially.

Same delegation table as Prompt 13:

| Sub-task | Subagent Role | Inputs | Outputs |
|----------|---------------|--------|---------|
| WPForms export scan | Exports/Payload Compare | WPForms CSV, per-env emails | Matched rows per env |
| CRM export scan | Exports/Payload Compare | CRM CSV, per-env emails | CRM row existence per env |
| Evidence scan | Evidence Scan | Runset evidence folders | Pass/fail per env, key artifacts |
| Expectation update | Expectation Updater (PATCH_ALLOWED) | Dev changelog, testcase paths | Updated `EXPECTED_OUTCOMES.md`, `expected_payload.json` per testcase |
| **Manager (you)** | — | Sub-task outputs + payloads | Reports, bundle updates |

---

## Execution Steps

### Step 0 — Bundle Selection

1. Ask for existing bundle directory path.
2. Confirm overwrite policy (default: `false`).
3. Verify bundle contains required structural files:
   - `llm/LLM_MANIFEST.json` (create if missing)
   - `llm/AGENTS.md`, `llm/CLAUDE.md`, `llm/.cursorrules` (add if missing)
   - `llm/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md` (add if missing)
   - Bundle-root copies: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `LLM_MANIFEST.json` (add if missing)
4. Confirm resolved bundle path.

### Step 0a — Dev Changelog Intake + Expectation Update

#### A) Changelog Acquisition (not blocking)

1. Check existing bundle for `raw/dev_changelog.md`:
   - If present: "Bundle has a changelog. Has anything changed since it was created?"
   - If "no": set `CHANGELOG_AVAILABLE = true`; reuse existing.
   - If "yes"/"unknown" or absent: continue to step 2.
2. Ask: "Do you already have a dev changelog file?"
3. **If YES**: validate, copy to canonical location + bundle `raw/dev_changelog.md`; set `CHANGELOG_AVAILABLE = true`.
4. **If NO**: check `playwright_phased_runner/changelogs/LATEST.txt`; if current, reuse and set `CHANGELOG_AVAILABLE = true`. Otherwise ask if codebase changed.
   - "yes"/"unknown" → collect via `framework/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md`; set `CHANGELOG_AVAILABLE = true`.
   - "no" → set `CHANGELOG_AVAILABLE = false`; note in `For_Recipient.md`.
5. Confirm changelog status.

#### B) Expectation Update (if changelog available)

**Trigger:** `CHANGELOG_AVAILABLE = true` AND changelog contains "Behavioral changes" or "Data format/mapping changes" sections with content.

**Delegate to Expectation Updater subagent (PATCH_ALLOWED mode):**

1. **Inputs to subagent:**
   - Changelog path (from bundle or canonical)
   - Testcase IDs from the runs being appended
   - Paths to each testcase's `EXPECTED_OUTCOMES.md` and `expected_payload.json`

2. **Subagent responsibilities:**
   - Parse changelog for behavioral and format changes
   - Propose updates to expectation files
   - Confirm each change with user
   - Apply confirmed updates
   - Return summary

3. **On subagent return:**
   - Copy `expectation_update_summary.md` to bundle `raw/`
   - Proceed with comparison using updated expectations

**Skip condition:** If `CHANGELOG_AVAILABLE = false` or no changes in changelog, skip to Step 1.

### Step 1 — Intake Loop

1. Ask: "How many runs are we appending?" (or one at a time).
2. Run the **Reporting Requirements Interview** per `09_SHARED_BLOCKS.md` § H.
3. For each run item, collect **Per-Run Intake Items** per `09_SHARED_BLOCKS.md` § I (items A–G).
4. Confirm resolved paths. Ask: "Proceed?"

### Step 2 — Generate Per-Run Reports

Per run:
1. Create canonical Env A report in `playwright_phased_runner/reports/` (same format as Prompt 13 Step 1).
2. Create deep analysis report for bundle `reports/` (same format as Prompt 13 Step 2).

### Step 2a — Stakeholder Interview Gate

Per `09_SHARED_BLOCKS.md` § F: If discrepancies exist, **pause** and run the Stakeholder Interview Gate.

- Present discrepancies, collect answers, record to `{bundle}/raw/stakeholder_answers.md`
- Apply classification: expected → NOTE, unexpected → ISSUE, unavailable → UNKNOWN

### Step 3 — Append Artifacts into Bundle

**A) Evidence:** Copy full runset folder to `evidence/{testcase_id}/{run_id}/...` (respect overwrite policy).

**B) Raw inputs:** Copy to `raw/` per run item: expected payloads, actual payload, CSV exports. If changelog newly collected: `raw/dev_changelog.md` + `raw/dev_changelog.checklist.json`.

**C) Reports:** Copy canonical payload report + deep analysis report to `reports/`.

### Step 4 — Update Bundle Indexes

Update/merge:
0. `llm/LLM_MANIFEST.json` — update runs[], reporting_expectations, changelog fields
1. `INDEX.md` — add new runs with stable ordering (by testcase_id, then run_id)
2. `INDEX.json` — append artifact records with stable ordering
3. `For_Recipient.md` — add per-run sections; ensure top points to `llm/LLM_MANIFEST.json`, `SUMMARY.json`, and `raw/dev_changelog.md`
4. `QUESTIONS_FOR_DEVELOPER.md` — update with new observations and questions (authoritative list)
5. `SUMMARY.json` — update runs[], key_findings[], open_questions[], known_issues[], evidence_paths; keep it small and valid JSON

### Step 5 — Loop / Finalize

- After each run: "Add another run? If no, reply `done`."
- Print: bundle path, new report paths, QUESTIONS_FOR_DEVELOPER.md path, any follow-ups.

---

## Acceptance Criteria

- [ ] New runs have canonical payload reports in `playwright_phased_runner/reports/`
- [ ] Bundle indexes (INDEX.md, INDEX.json) include all runs (old + new) with stable ordering
- [ ] SUMMARY.json updated and consistent with QUESTIONS_FOR_DEVELOPER.md
- [ ] For_Recipient.md updated with new run sections
- [ ] No existing run folders overwritten (unless overwrite=true)
- [ ] Bundle structural files present (LLM_MANIFEST.json, harness files, prompts)
- [ ] Observational reporting philosophy followed
- [ ] Stakeholder Interview Gate run when discrepancies exist (or fallback applied)
- [ ] Evidence paths in reports are valid
- [ ] If changelog contained behavioral/format changes, Expectation Updater subagent was invoked
- [ ] `raw/expectation_update_summary.md` documents any expectation changes made (or notes "no updates needed")

---

## Failure Modes / Escalation

| Condition | Action |
|-----------|--------|
| Bundle path doesn't exist | Ask user for correct path; do not create new bundle (use Prompt 13 instead) |
| Existing run folder collision (overwrite=false) | Ask user: skip, overwrite, or create new bundle |
| Evidence directory missing | Flag as BLOCKING; ask for correct path |
| Required inputs missing (Env A payload) | BLOCKING — cannot proceed |
| Optional inputs missing (WPForms/CRM CSV) | Proceed with partial analysis; note gaps |
| Stakeholder unavailable | Fallback: mark UNKNOWN, do not assume |
| Bundle missing structural files | Add them (copy from repo or llm/ equivalents) |
| Changelog has changes but testcase paths invalid | Ask user for correct testcase paths; do not guess |
| User declines all expectation updates | Proceed with original expectations; note in report that updates were declined |
| Expectation Updater subagent fails | Fall back to manual: list proposed changes in For_Recipient.md for manual update |
