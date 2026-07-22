# Pre-Gate Question Inventory Template

Output to chat — FULL NUMBERED LIST with evidence paths:

```
══════════════════════════════════════════════════════════════
PRE-GATE QUESTION INVENTORY — [TOTAL] items requiring clarification
══════════════════════════════════════════════════════════════

1. [VALUE_MISMATCH] Field: {crm_field_prefix}phone
   Expected: "(902) 555-1234"
   Actual: "9025551234"
   Evidence: raw/expected_payload.json:42, raw/sent_payload__A.json:38
   Question: Is this normalization (stripping formatting) intentional?

2. [MISSING_FIELD] Field: {crm_field_prefix}consent_timestamp
   Present in expected_payload.json but ABSENT from sent payload.
   Evidence: raw/expected_payload.json:67
   Question: Should this field be populated? Is it optional?

3. [API_ERROR] CRM rejection on attributionpath
   Error: "Field exceeds maximum length (100)"
   Actual length: 253 characters
   Evidence: evidence/A-logged_out/derived/error.log:17
   Question: What is the intended format for this field?

[...continue for all items...]

══════════════════════════════════════════════════════════════
TOTAL_QUESTIONS: [N]
GATE_TRIGGERS: [YES if N > 0, NO otherwise]
══════════════════════════════════════════════════════════════
```
