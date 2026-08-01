# Create Project Workflow

## Steps

1. **[USER] Collect info** — Client code, service category, framework name, project slug, and **project location**:
   - **Private operations:** inside `Mythos/clients/{code}/`
   - **External workspace:** an external client workspace repo (per client)
2. **[AUTO] Validate client registry** — Check `clients/{code}/client.json` exists (registry only; do not store artifacts here)
3. **[AUTO] Validate framework** — Check `frameworks/{service}/{framework}/manifest.json` exists
4. **[AUTO] Generate name** — `{service}__{framework}__{slug}`
5. **[AUTO] Create directory + scaffold**
   - Private operations mode: run the scaffold script from the Mythos repo root:
     ```bash
     node tools/workspace/scaffold-project.js --workspace "clients/{code}" --framework "{service}/{framework}" --slug "{slug}"
     ```
     This creates `clients/{code}/projects/{project_name}/` and installs intake templates. Requires `WORKSPACE_MANIFEST.json` in the client directory (created by `npm run workspace:scaffold -- --internal --client-code {code}`).
   - External workspace mode: run the scaffold script from the Mythos repo root:
     ```bash
     node tools/workspace/scaffold-project.js --workspace "<WORKSPACE_ROOT>" --framework "{service}/{framework}" --slug "{slug}"
     ```
     This creates `<WORKSPACE_ROOT>/projects/{project_name}/` and installs runtime assets (when available).
6. **[AUTO] Write/verify project.json**
   - External workspace mode: `project.json` is created by the scaffold script.
   - Private operations mode: `project.json` is also created by the scaffold script with `framework_id` linking to `{service}/{framework}`.
7. **[AUTO] Generate workflow guide** — If framework has `templates/WORKFLOW_GUIDE.template.md`, render it into the project directory as `WORKFLOW_GUIDE.md` with variables filled in (CLIENT_NAME, CLIENT_CODE, PROJECT_NAME).
8. **[AUTO] Confirm** — Report project created with path and next steps. Point user to `WORKFLOW_GUIDE.md` for step-by-step instructions.

## project.json Structure

Both modes use the same canonical schema. The scaffold script creates this automatically.

```json
{
  "client_code": "{{CODE}}",
  "service": "{{SERVICE}}",
  "framework": "{{FRAMEWORK}}",
  "framework_id": "{{SERVICE}}/{{FRAMEWORK}}",
  "slug": "{{SLUG}}",
  "project_name": "{{SERVICE}}__{{FRAMEWORK}}__{{SLUG}}",
  "created": "{{ISO_DATE}}",
  "status": "intake",
  "runtime": {}
}
```

The `runtime` object is populated only for frameworks that ship a runnable pack (e.g., `wordpress/qa` includes `framework_cli` and `playwright_phased_runner`). For private operations, `runtime` is typically empty or omitted since frameworks run via Mythos skills and commands.
