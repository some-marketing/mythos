# Navigation Cleanup Plan + Policy

## Goals
- Make the repo easy to navigate for:
  - humans (quick “where do I start?”)
  - LLM agents (clear canonical paths, minimal duplicates)
- Make “what is canonical vs legacy vs generated output” unambiguous.
- Preserve historical/legacy material without cluttering primary paths.
- Reduce the chance of accidentally committing PII or huge artifacts.

## Non-goals
- Rewriting the runner or changing test logic.
- Deleting historical artifacts without an explicit retention decision.

---

## Current state (after 2026-01-28 cleanup commit)

Completed:
- Canonical prompts are in `framework/prompts/` and legacy prompt sets are stubbed/deprecated.
- Duplicate docs under `docs/` now route to canonical `framework/docs/` where applicable.
- Legacy/duplicate content is preserved under `archive/2026-01-28/` and `_archive/` folders.
- Repo-root `testcases/` content was archived and replaced with `testcases/README.md` pointing to `playwright_phased_runner/testcases/`.
- Loose exports/zip bundles were moved out of the most visible paths (but additional cleanup remains).

Key navigation entrypoints:
- Prompts index: `framework/prompts/README.md`
- Canonical framework docs: `framework/docs/`
- Runner project: `playwright_phased_runner/`
- Root prompt index: `PROMPTS.md`

---

## Canonical location policy (source of truth)

### Prompts
- **Canonical:** `framework/prompts/`
- **Legacy reference:** `framework/prompts/_archive/`
- **Deprecated stubs:** `docs/template_prompts/` and `template_repo/prompts/` (stubs only; should not contain real content).

### Framework documentation
- **Canonical:** `framework/docs/`
- **Deprecated:** `docs/` (keep as thin routing stubs where older links exist).

### Runner implementation
- **Canonical runner code:** `playwright_phased_runner/runner/`
- **Runner project docs:** prefer `playwright_phased_runner/README.md`, avoid reintroducing a full duplicate `playwright_phased_runner/docs/` doc tree.

### Testcases and artifacts
- **Canonical testcases:** `playwright_phased_runner/testcases/<testcase_id>/`
- **Run artifacts (generated):** `playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/...`
- **Exports (manual downloads):** `playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/exports/`

### Handoff bundles
- **Canonical:** `playwright_phased_runner/dev_handoff/`
- Everything inside is treated as **generated output**, not core source.

---

## Deprecation and archiving rules

### “Move + stub + remove” lifecycle
1) **Move** legacy/duplicate content to a dated archive location:
   - `archive/YYYY-MM-DD/...` (repo-level)
   - or `<area>/_archive/YYYY-MM-DD/...` (area-local)
2) **Stub** the old path with a short “Deprecated → canonical path” file.
3) After an agreed period (e.g., 2 releases), optionally **remove** the stub if no longer needed.

### Archive naming convention
- Use ISO date folders: `YYYY-MM-DD` (UTC date of the cleanup).
- Prefer single-purpose archive buckets:
  - `archive/YYYY-MM-DD/docs/...`
  - `archive/YYYY-MM-DD/legacy_testcases/...`
  - `archive/YYYY-MM-DD/misc/...`

---

## Remaining cleanup backlog (recommended next steps)

### A) Create a root “Start here” README
Problem: repo root has many entrypoint docs and it’s unclear where to start.

Action:
- Add `README.md` at repo root that links to:
  - `framework/prompts/README.md`
  - `framework/docs/REPO_CONVENTIONS.md`
  - `framework/docs/REPORTING_PIPELINE.md`
  - `playwright_phased_runner/README.md`
  - `For_Developer.md` (handoff template)

### B) Consolidate duplicate “runner docs” inside `playwright_phased_runner/`
Problem: `playwright_phased_runner/docs/` is still a visible top-level folder but should mostly be deprecated in favor of `framework/docs/`.

Action:
- Decide whether to keep `playwright_phased_runner/docs/` permanently as a stub-only folder, or remove it entirely and rely on the repo-wide docs.

### C) Unify handoff conventions
Problem: `playwright_phased_runner/HANDOFF_FOR_DEVELOPER/` and `playwright_phased_runner/dev_handoff/` both exist.

Action:
- Pick one canonical (recommended: `dev_handoff/`).
- Move the other to `playwright_phased_runner/dev_handoff/_archive/<dated>/...` and leave a stub README at the old path.

### D) Tame size offenders
Problem: `playwright_phased_runner/node_modules/` dominates navigation and often should not live in a repo.

Action (proposal):
- Ensure `node_modules/` is not tracked.
- Add/confirm `.gitignore` rules (already present).
- Document “install steps” in `playwright_phased_runner/README.md`:
  - `npm ci`
  - `npm run install:browsers` (if required)

### E) Reduce top-level clutter inside `playwright_phased_runner/`
Problem: stray files like CSV exports, zips, and ad-hoc reports distract from the canonical structure.

Action:
- Any loose exports should live under:
  - `playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/exports/`
- Any ad-hoc generated root reports should be moved to:
  - `archive/YYYY-MM-DD/reports/`
  - or `playwright_phased_runner/reports/_archive/YYYY-MM-DD/`

### F) Fix remaining outdated references
Problem: some docs may still link to deprecated paths.

Action:
- Grep for:
  - `docs/template_prompts/`
  - `template_repo/prompts/`
  - `playwright_phased_runner/docs/`
  - repo-root `testcases/` references
- Update links to canonical locations.

---

## PII / generated-output safety policy

### Never commit
- CRM exports (CSV), WPForms exports (CSV/PDF), HARs, cookies, auth states, dev handoff zips.

### Allowed to commit (if synthetic and intended as fixtures)
- `expected_payload.json` (schema/samples)
- `identity.json` (synthetic)
- `locator_map.json`, `testcase.json`
- walkthrough findings markdown (if it contains no real PII)

When in doubt: archive locally + ignore, and document the retrieval steps instead.

---

## “Assign to Claude” prompt pointers
Use:
- `framework/prompts/15_NAVIGATION_CLEANUP_AND_DEPRECATION.md`
to execute the remaining backlog in a controlled, reviewable way.
