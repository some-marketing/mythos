# Canonical Routing

For a request scoped to a framework:

1. Resolve `{service}` and `{framework}`.
2. Load `frameworks/{service}/{framework}/manifest.json`.
3. Load `frameworks/{service}/{framework}/guardrails.md`.
4. If project-scoped, load `clients/{client_code}/{project_name}/project.json`.
5. Execute with framework-level instructions and declared execution modes.
