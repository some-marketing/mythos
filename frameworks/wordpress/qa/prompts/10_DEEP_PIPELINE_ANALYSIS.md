# 10 — Deep Pipeline Analysis (Exports + Contracts)

> **Type**: Atomic
> **Mode**: REVIEW_ONLY (no runs, no fixes)
> **Purpose**: Trace expected values through the full pipeline (identity → automation checks → WPForms export → CRM export) and produce an actionable analysis report.
> **Agent-platform agnostic**: Works with any agent that has shell + file access.

---

## Mode

- MODE = `REVIEW_ONLY` (no runs, no fixes)

---

## When to Use

- The UI run is PASS but backend data is wrong/missing.
- You have WPForms + CRM exports and need a field-by-field truth table.
- You suspect mapping contract drift (labels/columns changed).

---

## Inputs

- `PROJECT_ROOT`: repo root (contains `playwright_phased_runner/`)
- `TESTCASE_ID`
- `RUNSET_ID`
- `WPFORMS_EXPORT_CSV`: path to a WPForms export CSV
- `CRM_EXPORT_CSV`: path to a CRM export CSV

Optional:
- `INCLUDE_EXPORTS_IN_HANDOFF`: `true|false` (default false)

---

## Preflight

Before any comparison or synthesis, load and apply the **CRM Pipeline Integrity Discipline** block (`09_SHARED_BLOCKS.md` § J):

1. Evidence source hierarchy: sync-log payload → final CRM/destination table → staging/intermediate table → raw exports → derived stats. Never conclude "missing from CRM" from staging alone.
2. Complete the 4-step preflight order: pull sync-log payload, read the final CRM table (not staging), currency-check the evidence date against the codebase's latest commit, then arrange distinct-mind verification before accepting any acceptance-grade finding.
3. Same-population rule: any rate comparison across sources requires a per-record hashed/pseudonymous join — aggregate comparisons across mismatched populations are not valid.
4. Privacy: join on hashed/pseudonymous keys; report presence and format only; never send raw PII to an external model.

---

## Procedure

1) Confirm exports are stored under the runset:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/`

2) Run deterministic export comparison:
```bash
node framework/runner/cli.js compare-exports --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --wpforms "<WPFORMS_EXPORT_CSV>" --crm "<CRM_EXPORT_CSV>"
```

This writes reports under:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/`

3) Read the generated compare outputs:
- `compare__<RUNSET_ID>__backend-export-match__*.md` (email matching + picked rows)
- `compare__<RUNSET_ID>__mapping-contract__*.md` (if mapping CSVs exist)
- `compare__<RUNSET_ID>__expected-outcomes__*.md` (if EXPECTED_OUTCOMES.md + locator_map.json are present)

4) Write a single synthesis report:
`<PROJECT_ROOT>/playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/deep_analysis__<RUNSET_ID>__<YYYY-MM-DDThhmmssZ>.md`

Report must include:
- Executive summary: PASS / ISSUES_FOUND / FAIL
- For each env row matched (A/B/C): counts of matched/mismatched/skipped
- **Observation** items (per `09_SHARED_BLOCKS.md` § E): mapping gaps vs value mismatches vs empty fields in the final CRM/destination table (note whether staging vs final CRM was the source for each finding)
- For each finding: evidence chain (paths) + one `HYPOTHESIS` with evidence citation + one `Open Questions for Developer Context` item. Do NOT use "likely root cause" or "Top issues" — use `Observation` / `HYPOTHESIS` / `Open Questions for Developer Context` per the observational reporting policy in `09_SHARED_BLOCKS.md` § E.
- Staging vs final CRM distinction noted explicitly: if the evidence source was the staging/intermediate table, flag it as such and note that it is not the final CRM.

5) (Optional) Create a handoff bundle:
```bash
node framework/runner/cli.js handoff --project-root "<PROJECT_ROOT>" --testcase "<TESTCASE_ID>" --runset "<RUNSET_ID>" --include-exports
```

---

## Notes / Expectations

- If mapping CSVs are missing (`fields_mapped_to_crm.csv`, `system_fields_mapped_to_crm.csv`), call that out as a blocking gap for CRM assertions.
- Do not claim tracking works without proof in exports (or explicit automation proof artifacts).
- Never use "likely root cause" or "Top issues" — use `Observation` / `HYPOTHESIS` / `Open Questions for Developer Context` per `09_SHARED_BLOCKS.md` § E.
- Never infer "missing from CRM" from the staging/intermediate table; always verify against the final CRM/destination table per `09_SHARED_BLOCKS.md` § J.
