# Workflow (End-User Site Documentation via MCP)

## Roles
- **Claude (MCP Walkthrough / Capture)**: performs the browser walkthrough and produces step logs + screenshot list. No code changes.
- **GPT (Draft / Edit)**: writes polished docs (user-guide tone) from the captured step logs and screenshot references.
- **Claude (Verify)**: repeats the walkthrough following the draft docs and reports drift or missing steps.

## Standard Inputs
- SITE_NAME
- BASE_URL
- TARGET_AUDIENCE (role + constraints)
- TASKS (3-10 tasks the guide must cover)
- ACCOUNT_MODE: `none | demo | real` (prefer `demo`)
- SAFE_DATA_RULES (no secrets, no PII)

## Outputs (recommended)
For each task, create:
- `outputs/step_logs/STEP_LOG__<task_slug>__<YYYY-MM-DDThhmmssZ>.jsonl`
- `outputs/guides/GUIDE__<task_slug>__<YYYY-MM-DDThhmmssZ>.md`

Optional:
- `outputs/screenshots/<task_slug>/step-<NN>__<short>.png`
- `outputs/guides/FAQ__<task_slug>__<YYYY-MM-DDThhmmssZ>.md`

## Loop
1) Capture walkthrough -> 2) Draft docs -> 3) Verify docs -> 4) Revise docs

Stop when:
- verification passes for all tasks, and
- doc steps are stable and minimal (no brittle "click exactly here" when labels/menus exist).

