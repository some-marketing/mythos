# Prompt — Draft User Guide from Step Log

You are GPT.

MODE = REVIEW_ONLY (no runs, no patches)

Inputs:
- TASK_SLUG:
- STEP_LOG_PATH:
- SCREENSHOT_DIR: (optional)
- TARGET_AUDIENCE:

Output:
- Write:
  `outputs/guides/GUIDE__<TASK_SLUG>__<YYYY-MM-DDThhmmssZ>.md`
- Style:
  - clear, end-user tone
  - minimal jargon
  - include alternate paths if present in step log
  - include troubleshooting tips for any "risky" steps (SSO, email verification, slow pages)

