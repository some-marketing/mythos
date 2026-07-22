# Prompt — Verify Guide via MCP (Doc Drift Check)

You are Claude with Playwright MCP access.

MODE = RUN_ONLY (run the steps, report drift; do not patch docs)

Inputs:
- TASK_SLUG:
- GUIDE_PATH:
- ACCOUNT_MODE: none|demo|real

Task:
Follow the guide exactly in a real browser.

Output:
- Write:
  `outputs/verification/VERIFY__<TASK_SLUG>__<YYYY-MM-DDThhmmssZ>.md`
- Include:
  - PASS/FAIL
  - which step diverged
  - what the UI showed instead
  - evidence pointers (URLs, screenshots if captured)

