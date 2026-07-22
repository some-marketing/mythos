# 15 — Navigation Cleanup + Deprecation Pass (Repo Hygiene)

> **Type**: Atomic
> **Mode**: REPO_HYGIENE (no runner logic changes)
> **Purpose**: Reduce duplicate docs/prompts, archive legacy material, fix links, enforce safe ignore rules.
> **Agent-platform agnostic**: Works with any agent that has shell + file access.

## Goal
Make the repository easier to navigate by:
- reducing duplicate docs/prompt sets,
- moving legacy material into clearly labeled archives,
- leaving deprecation stubs for older paths,
- updating references to point to canonical locations,
- enforcing safe ignore rules for exports/PII.

## Inputs
- This policy doc: `framework/docs/NAVIGATION_CLEANUP_PLAN_AND_POLICY.md`

## Constraints (hard)
- Do **not** change runner/test logic (no modifications to automation behavior).
- Do **not** delete artifacts outright. Prefer **move → stub**.
- Do **not** add or commit PII (CSV exports, WPForms exports, HARs, cookies, auth states, handoff zips).
- Keep changes reviewable: small, well-scoped commits.

## Output
1) A short report describing what was changed (paths moved + new canonical pointers).
2) Updated indexes/READMEs so humans can find the canonical entrypoints quickly.

---

## Step 0 — Preflight
1) Confirm git is clean (except intentional untracked local artifacts).
2) Identify remaining “navigation offenders”:
   - large folders (e.g., `node_modules/`)
   - duplicate docs/prompts
   - stray exports/zips at top-level paths
   - outdated doc links to deprecated locations

---

## Step 1 — Add a root README entrypoint
Create `README.md` at repo root with:
- What this repo is for (1 paragraph)
- Where to start (bulleted links):
  - `framework/prompts/README.md`
  - `framework/docs/REPO_CONVENTIONS.md`
  - `framework/docs/REPORTING_PIPELINE.md`
  - `playwright_phased_runner/README.md`
  - `For_{DEVELOPER_NAME}.md`
- A “canonical vs generated output” note (1 paragraph)

---

## Step 2 — Finalize deprecation of duplicate doc trees
1) Audit `docs/`:
   - Any remaining full docs that duplicate `framework/docs/` should be moved to `archive/<DATE>/docs/` and replaced with stubs.
2) Audit `playwright_phased_runner/docs/`:
   - Keep only stub files + `README.md` (if the policy is “stub-only”).
   - Move any remaining full docs into `playwright_phased_runner/docs/_archive/<DATE>/`.

---

## Step 3 — Unify handoff conventions
1) Decide canonical:
   - prefer `playwright_phased_runner/dev_handoff/`
2) Deprecate other handoff folders (e.g., `playwright_phased_runner/HANDOFF_FOR_{DEVELOPER_NAME}/`):
   - move to `playwright_phased_runner/dev_handoff/_archive/<DATE>/...`
   - leave a stub README at the old path pointing to canonical.

---

## Step 4 — Reduce top-level clutter in `playwright_phased_runner/`
Move or archive stray files:
- loose exports → under the correct testcase runset `exports/` folder (or `archive/<DATE>/exports/` if unknown)
- loose zip bundles → into `playwright_phased_runner/dev_handoff/_zips/` (and ensure they remain ignored)

Also verify `.gitignore` ignores nested export CSVs and other sensitive artifacts.

---

## Step 5 — Update references
Search and update references to deprecated paths:
- `docs/template_prompts/` → `framework/prompts/`
- `template_repo/prompts/` → `framework/prompts/`
- `playwright_phased_runner/docs/` → `framework/docs/` or `playwright_phased_runner/README.md`
- repo-root `testcases/` → `playwright_phased_runner/testcases/`

Prefer updating links in:
- `PROMPTS.md`
- `framework/prompts/README.md`
- `framework/docs/*`
- any testcase `README.md`

---

## Step 6 — Commit strategy
Make small commits:
1) Root `README.md` + link fixes
2) Handoff convention cleanup
3) Remaining doc/prompt deprecations

Each commit message should start with `chore:` and describe the cleanup area.

---

## Final report (required)
At the end, output:
- A checklist of what moved and why
- The canonical “start here” paths
- Any remaining known offenders that require a product decision (e.g., whether to fully remove tracked `node_modules/`)

