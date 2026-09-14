# Observational Examples

Per 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy.

**WRONG (prescriptive):**
```
**Root Cause:** The attributionpath field exceeds the 100-char limit.

**Recommendations:**
1. Truncate attributionpath to 100 chars
2. Implement compact format: "source1→source2"

**Action Required:** Immediate backend fix
**Confidence Level:** VERY HIGH
```

**CORRECT (observational):**
```
**Observation:** The `{crm_field_prefix}attributionpath` field contained 253 characters.
The CRM API returned error code 0x80044331 citing a maximum length of 100 characters.

**HYPOTHESIS:** The field length (253 chars) exceeds the CRM's 100-char limit, which
may explain the API rejection. Evidence: `raw/error_logs.txt` line 17.

**Open Questions for Developer Context:**
1. What is the intended format for attributionpath?
2. Is the 100-char limit a schema constraint or API validation?

**Evidence Locations:**
- Error logs: `raw/error_logs.txt`
- Sent payload: `raw/run_0009__sent_payload__C.json`
```
