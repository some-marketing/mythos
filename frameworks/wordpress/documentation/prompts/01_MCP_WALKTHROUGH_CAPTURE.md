# Prompt — MCP Walkthrough Capture (Write Step Log + Screenshot List)

You are Claude with Playwright MCP access.

MODE = FINDINGS_ONLY (no patches, no automation coding)

Inputs:
- SITE_NAME:
- BASE_URL:
- TASK_SLUG:
- TASK_GOAL:
- ACCOUNT_MODE: none|demo|real
- SAFE_DATA_RULES:

Task:
Perform the task in a real browser, slowly and precisely. For each step:
- Write a step record to:
  `outputs/step_logs/STEP_LOG__<TASK_SLUG>__<YYYY-MM-DDThhmmssZ>.jsonl`
- If a screenshot would clarify, save it and reference it in the step record:
  `outputs/screenshots/<TASK_SLUG>/step-<NN>__<short>.png`

Step record requirements:
- Include exact UI text (button label, menu item, field label).
- Include a success check (what confirms the step worked).
- Include any branch conditions (role-based UI, empty states, modal flows).

Do not modify repo files other than writing the outputs above.

