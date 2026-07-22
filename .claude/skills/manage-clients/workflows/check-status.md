# Check Project Status

Reports the current status of a project.

Supports:
- Legacy Mythos projects under `clients/{CLIENT_CODE}/{PROJECT_NAME}/`
- Workspace projects by absolute/relative `PROJECT_ROOT` path

## Workflow

<step number="1" name="collect-inputs" type="USER">
[USER] Collect required inputs:
- Either:
  - PROJECT_ROOT: Path to the project root (recommended for workspace projects), or
  - CLIENT_CODE + PROJECT_NAME (legacy Mythos)

Ask: "Which client project do you want to check status for?"

**STOP and wait for user response before proceeding.**
</step>

<step number="2" name="validate-path" type="AUTO">
[AUTO] Validate that the project path exists:
- If PROJECT_ROOT provided:
  - Check `<PROJECT_ROOT>/project.json` exists
  - If not found, report error and stop
- Else (legacy):
  - Check `clients/{CLIENT_CODE}/{PROJECT_NAME}/` exists
  - Check `clients/{CLIENT_CODE}/{PROJECT_NAME}/project.json` exists
  - If not found, report error with available projects for the client
</step>

<step number="3" name="read-metadata" type="AUTO">
[AUTO] Read project metadata:
- Read `<PROJECT_ROOT>/project.json` (or legacy path)
- Extract: framework reference, creation date, status, last execution
- If CLIENT_CODE is known and `clients/{CLIENT_CODE}/client.json` exists, read it for client context
</step>

<step number="4" name="check-execution-history" type="AUTO">
[AUTO] Check for recent execution artifacts:
- Scan for output directories, reports, or run artifacts
- Identify the most recent execution timestamp
- Note any pending or failed executions
</step>

<step number="5" name="report-status" type="USER">
[USER] Present project status summary:
- Client: {CLIENT_CODE} — {client_name}
- Project: {PROJECT_NAME}
- Framework: {framework_reference}
- Status: {current_status}
- Last execution: {last_run_date} or "No executions found"
- Recent outputs: {list of recent artifacts}

**STOP and wait for user response before proceeding.**
</step>
