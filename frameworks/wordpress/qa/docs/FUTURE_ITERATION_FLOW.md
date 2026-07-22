# Future Iteration Flow

This document describes the full iteration loop for executing, validating, and resolving test runsets. The canonical loop consists of five phases (A through E).

All commands and paths in this document assume your working directory is the project root.

---

## The Canonical Loop (Phases A-E)

### Phase A: Allocate

Run the allocator to create a sequential runset folder:

```bash
node framework/runner/cli.js new-runset --testcase <TESTCASE_ID> [--tags "..."]
```

This creates `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/` with:
- `runset.meta.json`
- Pre-built `exports/` subdirectories

The RUNSET_ID is auto-assigned (e.g. `run_0007`).

### Phase B: Run A/B/C

Use prompt `framework/prompts/04_PARALLEL_RUN_MANAGER.md`. The manager spawns subagents for three environments:
- **A** (logged_out)
- **B** (logged_in)
- **C** (incognito)

Each produces per-env artifacts under `<RUNSET_ID>/<ENV>-<login_state>/`.

### Phase C: Collect Backend Exports

After runs complete, manually pull backend data from CRM and WPForms admin panels. Store exports at the **runset level** (not per-env), since they represent the combined backend state:

- `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/crm/crmstagings__exported-<YYYY-MM-DDThhmmssZ>.csv`
- `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/wpforms/wpforms__form-<FORM_ID>__exported-<YYYY-MM-DDThhmmssZ>.csv`
- `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/wpforms/wpforms__entry-<ENTRY_ID>__exported-<YYYY-MM-DDThhmmssZ>.pdf`

### Phase D: Compare and Synthesize

Use prompt `framework/prompts/03_REPORT_AND_DEV_HANDOFF.md` to analyze per-env artifacts. Compare automation proof (cookies, dataLayer, screenshots) with backend proof (CRM entries, WPForms entries). Diff reports go in:

- `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/compare/`

### Phase E: Decide Next Action

Based on analysis:

| Outcome | Action |
|---------|--------|
| ALL PASS + backend matches | Done. Archive runset. |
| FAIL (selector/timing) | Run MCP walkthrough (findings-only: `framework/prompts/05_MCP_WALKTHROUGH_FINDINGS_ONLY.md`) then implement fixes (`framework/prompts/07_IMPLEMENT_FIXES.md`) then rerun targeted envs (`framework/prompts/08_RERUN_VERIFY.md`). |
| FAIL (data/logic) | Implement fixes (`framework/prompts/07_IMPLEMENT_FIXES.md`) then rerun targeted envs (`framework/prompts/08_RERUN_VERIFY.md`). |
| Backend mismatch | Investigate attribution pipeline (not automation). |
| PREFLIGHT_FAIL | Resolve setup issue (e.g. record auth state manually — see LOCAL_SETUP.md) then rerun. |

---

## Stop Conditions

- All 3 envs PASS **and** backend exports confirm correct attribution entries.
- Maximum iterations exceeded (recommend 5 or fewer reruns per runset before escalating).
- Unresolvable preflight (e.g. target site down).

---

## Automation Proof vs Backend Proof

| Type | Source | Location | Contains PII |
|------|--------|----------|--------------|
| Automation proof | Playwright runner | `<ENV>-<login_state>/cookies/`, `evidence/`, `derived/` | No (synthetic test data) |
| Backend proof | Manual export from CRM/WPForms admin | `exports/crm/`, `exports/wpforms/` | YES (must not be committed) |
| Comparison reports | Analysis prompt output | `exports/compare/` | Possibly (references to entries) |

---

## Where to Store Exports Downloaded After Runs

Always at the **runset level**: `playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/exports/`

NOT at the per-env level. Rationale: CRM/WPForms exports contain entries from all envs combined.

Subfolders:
- `exports/crm/` -- Raw CRM CSV exports
- `exports/wpforms/` -- Raw WPForms CSV/PDF exports
- `exports/compare/` -- Diff/synthesis reports produced by analysis

---

## Naming Conventions

| Entity | Convention | Example |
|--------|-----------|---------|
| Runset ID | `run_NNNN` (zero-padded) | `run_0007` |
| Run ID (per-env) | `<ENV>_<RUNSET_ID>` | `A_run_0007` |
| Env folder | `<ENV>-<login_state>` | `A-logged_out`, `B-logged_in`, `C-incognito` |
| CRM export | `crmstagings__exported-<ISO>.csv` | `crmstagings__exported-2026-01-24T120000Z.csv` |
| WPForms CSV | `wpforms__form-<FORM_ID>__exported-<ISO>.csv` | `wpforms__form-12345__exported-2026-01-24T120000Z.csv` |
| WPForms PDF | `wpforms__entry-<ENTRY_ID>__exported-<ISO>.pdf` | `wpforms__entry-9876__exported-2026-01-24T120000Z.pdf` |
| Comparison report | `compare__<RUNSET_ID>__<description>__<ISO>.md` | `compare__run_0007__attribution-check__2026-01-24T130000Z.md` |

---

## What to Hand to a Developer

When escalating a failed runset to a developer, include these exact paths:

```
playwright_phased_runner/testcases/<TESTCASE_ID>/runs/<RUNSET_ID>/
├── runset.meta.json                          # Runset config + tags
├── A-logged_out/
│   ├── run.meta.json                         # Per-env config
│   ├── notes.md                              # Run diary (status line at top)
│   ├── derived/run.summary.json              # Machine-readable result
│   ├── derived/run.summary.md                # Human-readable result
│   ├── evidence/console.errors.summary.md    # Console error digest
│   ├── evidence/run.error.json               # Error details (if failed)
│   └── evidence/FAILURE.*.page.png           # Failure screenshot (if failed)
├── B-logged_in/ (same structure)
├── C-incognito/ (same structure)
├── exports/
│   ├── crm/crmstagings__exported-<ISO>.csv
│   ├── wpforms/wpforms__form-<ID>__exported-<ISO>.csv
│   └── compare/<analysis reports>
└── (reports/ at repo root — manager + per-env reports)
```

Also include from `reports/`:
- `PHASED_RUN_REPORT__<RUNSET_ID>__*.md` (manager summary)
- `PHASED_RUN_ENV_REPORT__<RUNSET_ID>__<ENV>__*.md` (per-env reports)

---

## Flow Diagram

```
Phase A          Phase B              Phase C            Phase D           Phase E
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────┐    ┌──────────────┐
│ Allocate │───▸│ Run A/B/C    │───▸│ Pull backend│───▸│ Compare & │───▸│ Decide next  │
│ runset   │    │ (parallel)   │    │ exports     │    │ synthesize│    │ action       │
└─────────┘    └──────────────┘    └─────────────┘    └───────────┘    └──────┬───────┘
                                                                              │
                                                     ┌────────────────────────┤
                                                     │                        │
                                                     ▼                        ▼
                                              ┌─────────────┐         ┌─────────────┐
                                              │ Fix + rerun  │         │ Done/archive │
                                              │ (targeted)   │         └─────────────┘
                                              └──────┬──────┘
                                                     │
                                                     └──── back to Phase B (targeted envs only)
```
