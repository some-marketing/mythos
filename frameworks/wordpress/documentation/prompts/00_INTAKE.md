# Prompt — Intake (What documentation should we produce?)

MODE = REVIEW_ONLY (no browsing, no patches)

Inputs:
- SITE_NAME:
- BASE_URL:
- TARGET_AUDIENCE:
- ACCOUNT_MODE: none|demo|real
- TASKS: (list)

Output:
- A `task list` with:
  - `task_slug`
  - goal / success criteria
  - required permissions/role
  - known risk (CAPTCHA, rate limits, SSO, 2FA)
- A proposed documentation set:
  - main guide(s)
  - quickstart
  - FAQ / troubleshooting

