# Create Client Workflow

## Steps

1. **[USER] Collect info** — Client code (uppercase, short), full name, industry, website
2. **[AUTO] Validate code** — Check code doesn't already exist in `clients/`
3. **[AUTO] Create directory** — Create `clients/{CODE}/`
4. **[AUTO] Write client.json** — Save client metadata
5. **[AUTO] Confirm** — Report client created with path
