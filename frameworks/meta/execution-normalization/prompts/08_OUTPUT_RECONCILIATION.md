# 08 — Output Reconciliation

## Type
Atomic

## Execution Mode
PATCH_ALLOWED — write reconciliation artifacts (JSON comparison and markdown report) scoped to the target framework's output directory. Do not modify source evidence files.

## Purpose
Implement deterministic field-by-field comparison between execution outputs and external system state. Reconciliation answers: "Did the external system receive and store what the framework produced?" It compares what the framework produced (evidence, payloads, results) against what an external system received or stored, and classifies every field as MATCH, MISMATCH, MISSING, EXTRA, or FORMAT_DELTA.

---

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `docs/ARTIFACT_CONTRACT.md` | Yes | Canonical source for reconciliation artifact naming, output structure, and identity field definitions |
| Execution output artifacts | Yes | Sent payloads, submitted data, and captured evidence produced during the run |
| External system exports | Yes | Data exported or extracted from the external system after execution; paths and formats are declared in the `EXTERNAL_EXPORTS` binding |
| `MATCH_KEYS` binding | Yes | The identity fields used to correlate execution records to external records |
| `FIELD_MAP` binding | Yes | Mapping of execution output field names to their corresponding external system field names |
| `KNOWN_FORMAT_DELTAS` binding | No | Registry of field differences that are expected and acceptable (e.g., date format normalization, whitespace trimming) |

---

## Process

### Step 1: Read ARTIFACT_CONTRACT.md [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md`
2. Extract the reconciliation artifact naming convention and required output structure
3. Identify the declared identity fields that define a unique record
4. If `docs/ARTIFACT_CONTRACT.md` does not exist, STOP and report that contract definition (Prompt 01) must be completed first

### Step 2: Read Execution Output Artifacts [AUTO]
1. Locate all execution output artifacts produced during the run (payloads, submissions, captured evidence)
2. For each artifact, record:
   - The artifact name and path
   - The fields present and their values
   - The identity field values (per `MATCH_KEYS` binding) for each record
3. Build an in-memory index of execution records keyed by their identity field values
4. If no execution output artifacts exist, STOP and report that at least one run must be completed before reconciliation

### Step 3: Read External System Exports [AUTO]
1. Using the `EXTERNAL_EXPORTS` binding, locate the exported data from the external system
2. For each export, record:
   - The export name and path or source reference
   - The fields present and their values
   - The identity field values (per `MATCH_KEYS` binding) for each record
3. Build an in-memory index of external records keyed by their identity field values
4. If external exports cannot be located, STOP and report the missing exports with the `EXTERNAL_EXPORTS` binding value for traceability

### Step 4: Match Records by Identity Fields [AUTO]
1. For each execution record, attempt to find a matching external record using the `MATCH_KEYS` binding
2. Classify each pairing:
   - **Matched**: An execution record and an external record share the same identity field values
   - **Execution-Only**: An execution record has no corresponding external record (the system did not receive it)
   - **External-Only**: An external record has no corresponding execution record (the system has data not produced by this run)
3. Report match statistics: total execution records, total external records, matched pairs, execution-only count, external-only count

### Step 5: Compare Fields on Matched Pairs [AUTO]
For each matched pair, compare every field declared in the `FIELD_MAP` binding:

1. Apply the field name mapping from `FIELD_MAP` to align execution field names with external field names
2. For each mapped field pair, classify the comparison result:
   - **MATCH**: Values are identical after normalization
   - **MISMATCH**: Values differ in a way not covered by `KNOWN_FORMAT_DELTAS`
   - **MISSING**: The field is present in the execution output but absent from the external record
   - **EXTRA**: The field is present in the external record but absent from the execution output
   - **FORMAT_DELTA**: Values differ only in a way registered in the `KNOWN_FORMAT_DELTAS` binding (e.g., date representation, encoding)
3. Record the execution value, the external value, and the classification for every field in every matched pair
4. Do not attempt to resolve or auto-correct any differences — classification only

### Step 6: Produce Structured Comparison and Observational Report [AUTO]
Write two reconciliation artifacts:

**`reconciliation_{run_id}.json`** — structured comparison per the ARTIFACT_CONTRACT:
```json
{
  "run_id": "...",
  "reconciliation_timestamp": "ISO-8601",
  "summary": {
    "total_execution_records": 0,
    "total_external_records": 0,
    "matched_pairs": 0,
    "execution_only": 0,
    "external_only": 0,
    "field_comparison_counts": {
      "MATCH": 0,
      "MISMATCH": 0,
      "MISSING": 0,
      "EXTRA": 0,
      "FORMAT_DELTA": 0
    }
  },
  "record_comparisons": [
    {
      "identity": {},
      "match_status": "matched|execution_only|external_only",
      "field_results": [
        {
          "execution_field": "...",
          "external_field": "...",
          "execution_value": "...",
          "external_value": "...",
          "classification": "MATCH|MISMATCH|MISSING|EXTRA|FORMAT_DELTA",
          "format_delta_rule": "name of known rule if FORMAT_DELTA, else null"
        }
      ]
    }
  ],
  "execution_only_records": [],
  "external_only_records": []
}
```

**`reconciliation_{run_id}.md`** — observational report using the standard reporting format:
- **Observation:** summary of match rates and classification counts with evidence citations
- **HYPOTHESIS:** any interpretation of recurring MISMATCH or MISSING patterns (labeled, not asserted)
- **Open Questions for Review:** items where domain knowledge is required to determine acceptability

### Step 7: Never Modify Evidence [AUTO]
1. Confirm that no source evidence files were modified during this prompt's execution
2. All reconciliation artifacts are additive outputs — the source evidence remains unchanged
3. If any evidence modification is detected, report it as a blocking observation before writing outputs

### Step 8: Review Mismatches [USER]
1. Present the reconciliation summary to the user:
   - Total matched pairs and unmatched records
   - MISMATCH and MISSING counts by field name
   - FORMAT_DELTA items with the matched rule name
2. Ask the user to identify any mismatches that represent acceptable domain-specific deltas
3. For each user-identified acceptable delta, note it as a candidate for the `KNOWN_FORMAT_DELTAS` binding
4. Do not auto-update the binding — record the suggested additions as open questions
5. STOP and wait for user response before finalizing the report

---

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| Reconciliation JSON | Per ARTIFACT_CONTRACT naming | Structured field-by-field comparison for all matched and unmatched records |
| Reconciliation Report | Per ARTIFACT_CONTRACT naming | Observational markdown report with summary, patterns, and open questions |

---

## Graduation Path

| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM reads exported data and execution output side-by-side and writes the comparison report by hand |
| L1 | Verified | Verification checks confirm that the reconciliation JSON covers all fields declared in `FIELD_MAP` and uses the required classification vocabulary |
| L2 | Coded | Field comparison logic is implemented as code; every classification is deterministic given the same inputs |
| L3 | Code-owned | Code handles all known field types and FORMAT_DELTA rules; LLM is invoked only to classify ambiguous format deltas not covered by any registered rule |
| L4 | Mechanical | All delta types are code-classified; LLM is invoked only when a new field type appears that no existing schema or rule can handle |

---

## Binding Points

| Binding | Required | Purpose |
|---------|----------|---------|
| `EXTERNAL_EXPORTS` | Yes | Paths or location references for the external system's exported data; defines where and in what form external records can be read |
| `MATCH_KEYS` | Yes | Ordered list of field names used to correlate execution records with external records; must be unique per record pair |
| `FIELD_MAP` | Yes | Mapping of execution output field names to their corresponding external system field names; used for field-level comparison |
| `KNOWN_FORMAT_DELTAS` | No | Registry of named rules for field differences that are expected and acceptable; each rule defines the execution pattern, external pattern, and the normalization that makes them equivalent |

---

## Failure Modes

| Condition | Action |
|-----------|--------|
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| No execution output artifacts found | STOP; at least one run must produce output before reconciliation can proceed |
| External exports cannot be located via `EXTERNAL_EXPORTS` | STOP; report the binding value and request that exports be provided |
| `MATCH_KEYS` binding is not supplied | STOP; record identity cannot be established without match key definitions |
| `FIELD_MAP` binding is not supplied | STOP; field-level comparison cannot be performed without a declared mapping |
| All records are execution-only (no matches) | Report as a complete divergence; do not proceed to field comparison; escalate to user |
| A field in `FIELD_MAP` does not exist in either artifact | Report as a gap observation; skip the unmappable field; continue with remaining fields |
| User identifies a domain-acceptable delta in Step 8 | Record as candidate for `KNOWN_FORMAT_DELTAS`; do not auto-modify the binding |
