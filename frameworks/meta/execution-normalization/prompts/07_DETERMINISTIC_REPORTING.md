# 07 — Deterministic Reporting

## Type
Atomic

## Execution Mode
PATCH_ALLOWED — implement the report generation module scoped to the target framework's runner directory. Write reports to the declared output paths within the run container. Do not modify run artifacts, execution results, or Mythos system files.

## Purpose
Implement deterministic (Layer 1) report generation that extracts factual observations from run evidence without interpretation. Given the same run artifacts as input, the generated reports must always be identical. No LLM interpretation, no subjective classification, no recommendations.

"Deterministic" is the acceptance criterion: two executions of this module against the same run container must produce byte-for-byte equivalent output. Any step that introduces judgment or variation violates this constraint.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| Run container with completed execution | Yes | An allocated run container (Prompt 04) containing per-step results and evidence from a completed execution (Prompt 05) |
| `docs/ARTIFACT_CONTRACT.md` | Yes | Report naming conventions, required sections, output path patterns, and artifact index schema |
| `REPORT_TEMPLATES` binding | Yes | Templates used to generate per-environment and aggregated reports; defines section names and slot locations |
| `REPORT_OUTPUT_PATHS` binding | Yes | Root-relative paths where each report type is written within the run container |
| `EVIDENCE_SUMMARY_SCHEMA` binding | Yes | Field names and types expected in the evidence summary section of each report |

## Process

### Step 1: Read ARTIFACT_CONTRACT.md [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md`
2. Extract:
   - Required sections for per-environment reports
   - Required sections for the aggregated run report
   - Artifact index schema (fields, types, required/optional)
   - Output file naming patterns and directory structure
3. If `docs/ARTIFACT_CONTRACT.md` does not exist, STOP and report that Prompt 01 must be completed first

### Step 2: Read Run Artifacts [AUTO]
Read the following from the run container. Record an observation if any expected artifact is absent.

**Run metadata:**
- Run ID
- Start time (ISO-8601)
- List of environments
- Source input reference

**Per-step results:**
- For each step: step ID, step type, lifecycle state (passed/failed/skipped), evidence paths, error details, execution timestamp
- Record exact counts: total steps, passed steps, failed steps, skipped steps

**Evidence inventory:**
- Traverse all evidence paths referenced in the per-step results
- For each path, confirm the file exists and record: path, artifact type (from ARTIFACT_TYPES), file size in bytes
- If an evidence path does not exist on disk, record it as a `MISSING_EVIDENCE` observation with the referencing step ID

**Error records:**
- Collect all steps with `lifecycle_state: failed`
- For each, extract the structured error details from the result record

**Provenance check:**
- Pass/fail counts derived from step results MUST equal the sum of individual step states
- If counts do not reconcile, STOP and report the discrepancy before writing any report

### Step 3: Extract Per-Environment Factual Summaries [AUTO]
For each environment declared in the run metadata:

1. Filter per-step results to only steps that executed against this environment
2. Compute from the filtered set — exact integers only, no rounding or approximation:
   - Total steps executed in this environment
   - Passed step count
   - Failed step count
   - Skipped step count
   - Evidence artifact count for this environment
3. Collect timing data if present in step results: first step start time, last step end time
4. Collect error details for all failed steps in this environment

**Determinism check:**
- All values must be derived directly from the step result records — no interpolation, no inference
- If a field declared in `EVIDENCE_SUMMARY_SCHEMA` cannot be populated from the run artifacts, write the field as null with a note "not present in run artifacts" — do not estimate or omit

### Step 4: Generate Per-Environment Reports [AUTO]
For each environment, generate a report by populating the template declared in `REPORT_TEMPLATES`:

1. Read the environment's template from the `REPORT_TEMPLATES` binding
2. Populate each slot in the template with the corresponding value from Step 3
3. Do not add content to the report that is not defined by a slot in the template
4. Do not omit any slot — if a value is unavailable, write the null representation declared in the template
5. Write the completed report to the path declared in `REPORT_OUTPUT_PATHS` for this environment

**Determinism check:**
- The only variable inputs to the template are the factual values extracted in Step 3
- No LLM-generated prose, no summaries, no interpretations

### Step 5: Generate Aggregated Run Report [AUTO]
Generate a cross-environment summary by aggregating the per-environment summaries:

1. Read the aggregated report template from the `REPORT_TEMPLATES` binding
2. Compute cross-environment totals from the per-environment summaries — exact integers:
   - Total steps across all environments
   - Total passed, failed, skipped across all environments
   - Total evidence artifacts across all environments
3. Include the per-environment summary row for each environment (one row per environment in the aggregated report)
4. Write the completed aggregated report to the path declared in `REPORT_OUTPUT_PATHS` for the run-level report

### Step 6: Generate Artifact Index [AUTO]
Generate an inventory of all files produced during the run:

1. Traverse the run container directory recursively
2. For each file, record:
   - Path relative to the run container root
   - Artifact type (from `ARTIFACT_TYPES` binding if applicable; otherwise `UNCLASSIFIED`)
   - File size in bytes
   - Producing step ID (if the file appears in a step result's `evidence_paths`; otherwise `RUN_SYSTEM`)
3. Write the artifact index to the path declared in `docs/ARTIFACT_CONTRACT.md`

**Provenance check:**
- Every file in the index must exist on disk at the recorded path
- Do not include files that were expected but not produced — those are `MISSING_EVIDENCE` observations (from Step 2), not index entries

### Step 7: Write All Reports to Canonical Output Paths [AUTO]
1. Confirm all reports from Steps 4, 5, and 6 have been written to the paths declared in `REPORT_OUTPUT_PATHS`
2. For each output file, verify:
   - The file exists at the declared path
   - The file is non-empty
   - Required sections (per `docs/ARTIFACT_CONTRACT.md`) are present in the file
3. If any output file fails verification, record a `REPORT_INCOMPLETE` observation with the specific missing section or empty file
4. Write a completion record to the run container indicating which reports were successfully generated

### Step 8: Review One Generated Report [USER]
1. Present the path to one generated per-environment report to the user
2. Ask the user to confirm:
   - All factual values are correctly extracted (pass/fail counts, evidence paths, timing data)
   - No interpretive language or recommendations appear in the report
   - All required sections are present
3. If the user identifies factual inaccuracies, record them as open questions and adjust the extraction logic (Step 3) before re-generating
4. Do not declare this prompt complete until the user confirms factual accuracy or explicitly defers review

## Output
| Artifact | Path | Description |
|----------|------|-------------|
| Per-environment reports | Per `REPORT_OUTPUT_PATHS` binding | One report per environment with factual pass/fail counts, evidence paths, and timing data |
| Aggregated run report | Per `REPORT_OUTPUT_PATHS` binding | Cross-environment summary report |
| Artifact index | Per `docs/ARTIFACT_CONTRACT.md` | Complete inventory of all files produced in the run container |
| Report generation module | Runner directory (per ARTIFACT_CONTRACT.md) | Code implementing Steps 1–7 as a deterministic, callable report generator |

## Graduation Path
| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM reads run evidence and writes reports manually for each run |
| L1 | Verified | A verification check confirms that all required sections exist in each report and that pass/fail counts are internally consistent |
| L2 | Coded | Report generator is stable code using the `REPORT_TEMPLATES` binding; output is reproducible given the same input |
| L3 | Code-owned | Code generates all reports; LLM reviews output only when a `REPORT_INCOMPLETE` or `MISSING_EVIDENCE` observation is flagged |
| L4 | Mechanical | Fully mechanical; no LLM involvement in report generation for any run |

## Binding Points
| Binding | Required | Purpose |
|---------|----------|---------|
| `REPORT_TEMPLATES` | Yes | Templates for per-environment and aggregated reports; defines which slots accept factual values and in what format |
| `REPORT_OUTPUT_PATHS` | Yes | Root-relative paths within the run container where each report type is written |
| `EVIDENCE_SUMMARY_SCHEMA` | Yes | Field names and types used to populate the evidence summary section of each report; drives null-handling for missing fields |

## Failure Modes
| Condition | Action |
|-----------|--------|
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| Run container has no per-step results | STOP; Prompt 05 must be completed first for this run |
| Pass/fail counts from step results do not reconcile | STOP; report the specific discrepancy before writing any report |
| A slot in `REPORT_TEMPLATES` cannot be populated from run artifacts | Write the slot as null with note "not present in run artifacts"; do not omit or estimate |
| An output file is empty after writing | Record a `REPORT_INCOMPLETE` observation; do not declare the report generated |
| A required report section is absent from generated output | Record a `REPORT_INCOMPLETE` observation citing the missing section name |
| User identifies factual inaccuracies in Step 8 | Record as open questions; adjust extraction logic and re-generate before proceeding |
