# Framework Intake Workflow

## Steps

1. **[AUTO] Read manifest** — Load `frameworks/{service}/{framework}/manifest.json`
2. **[AUTO] Check input contract** — List required and optional inputs
3. **[USER] Collect inputs** — Gather all required inputs from user or project files
4. **[AUTO] Validate inputs** — Check against schemas if available
5. **[AUTO] Write to project** — Save inputs to `<PROJECT_ROOT>/intake/`
6. **[AUTO] Report readiness** — Confirm all inputs collected, ready for execution

## Project Root Resolution

This workflow is compatible with both:
- **Private operations projects:** `Mythos/clients/{code}/{service}__{framework}__{slug}/`
- **External workspace projects:** `<WORKSPACE_ROOT>/projects/{service}__{framework}__{slug}/`

The executor must treat `<PROJECT_ROOT>` as the authoritative output base.
