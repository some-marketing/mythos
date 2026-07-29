# Guardrails (Safety + Quality)

## Safety
- Do not include secrets, auth tokens, or real PII in docs or logs.
- Prefer demo/staging accounts. If real accounts are required, redact identifiers.
- Do not instruct users to bypass security mechanisms.

## Accuracy
- Always include the exact UI labels used (menu names, button text).
- Prefer robust directions ("Settings -> Billing") over pixel/position instructions.
- Record alternate paths if the UI differs by role/plan.

## Evidence
- Each step should include an "evidence" field:
  - the selector or accessible name used
  - the observed URL (if relevant)
  - optional screenshot path

## Drift handling
- If verification finds drift:
  - update docs
  - keep an "UI drift notes" section listing what changed and when

