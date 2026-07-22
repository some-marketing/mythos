# Create Project Workflow

## Steps

1. **[USER] Collect info** — Client code, service category, framework name, project slug, and **project location**:
   - **Recommended:** an external client workspace repo (per client)
   - **Legacy:** inside `learning-language-models/clients/{code}/`
2. **[AUTO] Validate client registry** — Check `clients/{code}/client.json` exists (registry only; do not store artifacts here)
3. **[AUTO] Validate framework** — Check `frameworks/{service}/{framework}/manifest.json` exists
4. **[AUTO] Generate name** — `{service}__{framework}__{slug}`
5. **[AUTO] Create directory + scaffold**
   - Workspace mode (recommended): run the scaffold script from the learning-language-models repo root:
     ```bash
     node tools/workspace/scaffold-project.js --workspace "<WORKSPACE_ROOT>" --framework "{service}/{framework}" --slug "{slug}"
     ```
     This creates `<WORKSPACE_ROOT>/projects/{project_name}/` and installs runtime assets (when available).
   - Legacy mode: create `clients/{code}/{project_name}/` and scaffold templates to `intake/` (no runtime pack).
6. **[AUTO] Write/verify project.json**
   - Workspace mode: `project.json` is created by the scaffold script.
   - Legacy mode: write `project.json` linked to framework path under `frameworks/{service}/{framework}/`.
7. **[AUTO] Generate workflow guide** — If framework has `templates/WORKFLOW_GUIDE.template.md`, render it into the project directory as `WORKFLOW_GUIDE.md` with variables filled in (CLIENT_NAME, CLIENT_CODE, PROJECT_NAME).
8. **[AUTO] Confirm** — Report project created with path and next steps. Point user to `WORKFLOW_GUIDE.md` for step-by-step instructions.

## project.json Structure

### Workspace mode (recommended)
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
  "runtime": {
    "framework_cli": "framework/runner/cli.js",
    "playwright_phased_runner": "playwright_phased_runner"
  }
}
```

### Legacy mode (inside Mythos)
```json
{
  "client_code": "{{CODE}}",
  "service": "{{SERVICE}}",
  "framework": "{{FRAMEWORK}}",
  "slug": "{{SLUG}}",
  "project_name": "{{SERVICE}}__{{FRAMEWORK}}__{{SLUG}}",
  "framework_path": "frameworks/{{SERVICE}}/{{FRAMEWORK}}/",
  "created": "{{ISO_DATE}}",
  "status": "intake"
}
```
