# 06 — Parity Verification

## Type
Atomic

## Execution Mode
RUN_ONLY — executes comparison logic and writes reports only. This prompt does NOT modify run artifacts, fix discrepancies, or alter the execution environment. Source files, run containers, and framework definitions are read-only.

## Purpose
Compare output from the new native engine against output from the legacy execution path to verify functional equivalence. Discrepancies are classified and reported. This prompt produces observational reports only — it does not resolve, patch, or explain away findings.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| Legacy run evidence | Yes | Complete run container from a prior execution through the legacy path |
| Native run evidence | Yes | Complete run container from an execution through the new native engine |
| `docs/ARTIFACT_CONTRACT.md` | Yes | Canonical reference for artifact types, naming, and structure |
| `LEGACY_RUN_PATH` binding | Yes | Root path of the legacy run container to compare against |
| `NATIVE_RUN_PATH` binding | Yes | Root path of the native engine run container |
| `ARTIFACT_TYPES` binding | Yes | Enumeration of artifact types expected in both runs |
| `KNOWN_DELTA_CLASSES` binding | No | Pre-declared delta classes the framework author considers intentional or acceptable |

## Process

### Step 1: Identify the Test Case [AUTO]
1. Read the run metadata file from both `LEGACY_RUN_PATH` and `NATIVE_RUN_PATH`
2. Confirm that both runs reference the same compiled plan or equivalent source input
3. If the runs cannot be confirmed as derived from equivalent inputs, record an `UNKNOWN` observation with supporting evidence and continue — do not halt unless the metadata files are entirely absent
4. Record:
   - Legacy run ID, source input reference, execution timestamp
   - Native run ID, source input reference, execution timestamp

### Step 2: Inventory All Output Artifacts [AUTO]
**Legacy run inventory:**
1. Traverse the `LEGACY_RUN_PATH` directory recursively
2. For each file, record: relative path, file type, size in bytes, last-modified timestamp
3. Organize by artifact type using the `ARTIFACT_TYPES` binding

**Native run inventory:**
1. Traverse the `NATIVE_RUN_PATH` directory recursively
2. Apply the same recording and organization procedure

**Cross-inventory:**
1. Identify artifacts present in legacy but absent from native (legacy-only)
2. Identify artifacts present in native but absent from legacy (native-only)
3. Identify artifacts present in both (candidate pairs for comparison)

**Observation:** Record exact file counts for each category. Do not approximate.

### Step 3: Compare Artifact by Artifact [AUTO]
For each candidate pair identified in Step 2:

**Structure comparison:**
- Compare directory depth, subdirectory names, and file naming patterns
- Record: MATCH, STRUCTURAL_DIFFERENCE, or NAMING_DIFFERENCE for each pair

**Semantic equivalence:**
- Read the content of both artifacts
- For structured data (machine-readable formats declared in `ARTIFACT_TYPES`): compare field presence, field values, and record counts
- For human-readable reports: compare section presence, heading structure, and factual claims (counts, identifiers, states)
- Record: EQUIVALENT, SEMANTICALLY_DIFFERENT, or UNABLE_TO_COMPARE for each pair

**Format differences:**
- Note any differences in serialization, encoding, or whitespace that do not affect semantic content
- Record format differences separately from semantic differences

**Evidence obligation:**
- Every comparison result must cite the exact paths of both artifacts being compared
- Do not assert equivalence or difference without citing the specific content compared

### Step 4: Classify Each Delta [AUTO]
For each identified difference, assign exactly one classification:

| Classification | Condition |
|----------------|-----------|
| `INTENTIONAL_IMPROVEMENT` | Delta matches a class declared in `KNOWN_DELTA_CLASSES` binding with `intent: improvement` |
| `ACCEPTABLE_COSMETIC` | Delta matches a class declared in `KNOWN_DELTA_CLASSES` binding with `intent: cosmetic` |
| `BLOCKING_REGRESSION` | Delta is a semantic difference in a required artifact with no matching entry in `KNOWN_DELTA_CLASSES` |
| `UNKNOWN` | Delta cannot be classified against any known class; insufficient evidence to determine intent |

**Classification rules:**
- If `KNOWN_DELTA_CLASSES` binding is not supplied, all semantic differences default to `BLOCKING_REGRESSION` pending human review
- A structural difference that causes a required artifact to be absent is always `BLOCKING_REGRESSION`
- Format-only differences with no semantic impact default to `ACCEPTABLE_COSMETIC`
- Do not infer intent from the content of the delta — classification must come from the binding or the above rules

### Step 5: Cite Evidence for Blocking Regressions [AUTO]
For each delta classified as `BLOCKING_REGRESSION`:
1. Record the exact file paths from both runs
2. Quote or describe the specific content that differs (do not fabricate — if content is binary or non-readable, record "content not readable: [reason]")
3. Record the artifact type from the `ARTIFACT_TYPES` binding
4. Label the finding with severity classification:
   - CRITICAL: required artifact is absent from the native run
   - MAJOR: required artifact is present but semantically different from legacy
   - MINOR: optional artifact differs from legacy

### Step 6: Write the Observational Parity Report [AUTO]
Write `parity_report.md` to the output directory with the following structure:

```
# Parity Verification Report

## Run Identifiers
- Legacy run: [run ID, path, timestamp]
- Native run: [run ID, path, timestamp]
- Input equivalence: [CONFIRMED | UNCONFIRMED — with observation]

## Artifact Inventory Summary
- Artifacts in both runs: [exact count]
- Legacy-only artifacts: [exact count]
- Native-only artifacts: [exact count]

## Delta Summary
| Classification | Count |
|----------------|-------|
| INTENTIONAL_IMPROVEMENT | N |
| ACCEPTABLE_COSMETIC | N |
| BLOCKING_REGRESSION | N |
| UNKNOWN | N |
| **Total deltas** | **N** |

## Blocking Regressions
[For each BLOCKING_REGRESSION, one entry:]

**Observation:** [factual description of what differs]
**Evidence Locations:**
- Legacy: `[path]` — [description of content]
- Native: `[path]` — [description of content, or "artifact absent"]
**Severity:** CRITICAL | MAJOR | MINOR
**Artifact Type:** [from ARTIFACT_TYPES binding]

## Unknown Deltas
[For each UNKNOWN delta:]

**Observation:** [factual description of what was observed]
**HYPOTHESIS:** [labeled interpretation — explicitly non-definitive]
**Evidence Locations:**
- Legacy: `[path]`
- Native: `[path]`

## Intentional Improvements
[For each INTENTIONAL_IMPROVEMENT, one entry with evidence location]

## Acceptable Cosmetic Differences
[For each ACCEPTABLE_COSMETIC, one entry with evidence location]

## Open Questions for Review
[Any ambiguous deltas, unconfirmed input equivalence, or artifact types requiring human judgment]
```

**Provenance check before finalizing:**
1. Every finding must cite at least one evidence location
2. Scan for forbidden labels per guardrails: Root Cause, Diagnosis, Recommendation, Confidence Level
3. Replace any forbidden labels with the required equivalents before writing
4. Do not include time estimates, subjective assessments, or prescriptive language

### Step 7: Write Machine-Readable Comparison JSON [AUTO]
Write `parity_report.json` to the output directory:

```json
{
  "legacy_run": {
    "run_id": "...",
    "path": "...",
    "timestamp": "ISO-8601"
  },
  "native_run": {
    "run_id": "...",
    "path": "...",
    "timestamp": "ISO-8601"
  },
  "input_equivalence": "confirmed|unconfirmed",
  "generated_at": "ISO-8601",
  "artifact_inventory": {
    "both_runs": 0,
    "legacy_only": 0,
    "native_only": 0
  },
  "delta_summary": {
    "INTENTIONAL_IMPROVEMENT": 0,
    "ACCEPTABLE_COSMETIC": 0,
    "BLOCKING_REGRESSION": 0,
    "UNKNOWN": 0,
    "total": 0
  },
  "deltas": [
    {
      "artifact_type": "...",
      "classification": "INTENTIONAL_IMPROVEMENT|ACCEPTABLE_COSMETIC|BLOCKING_REGRESSION|UNKNOWN",
      "severity": "CRITICAL|MAJOR|MINOR|null",
      "legacy_path": "...",
      "native_path": "...",
      "description": "factual description of the delta"
    }
  ]
}
```

## Output
| Artifact | Path | Description |
|----------|------|-------------|
| `parity_report.md` | Run output directory | Observational parity report with delta classification and evidence citations |
| `parity_report.json` | Run output directory | Machine-readable comparison record for downstream automation |

## Graduation Path
| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM manually compares outputs from both runs and writes the report by hand |
| L1 | Verified | A verification check confirms that parity_report.md exists and covers all artifact types declared in `ARTIFACT_TYPES` |
| L2 | Partial code | Comparison logic is implemented as code for structural and format checks; LLM handles semantic content comparison |
| L3 | Code-owned comparison | Code performs all comparison and classification steps; LLM reviews and classifies only ambiguous deltas flagged as `UNKNOWN` |
| L4 | Mechanical | Code classifies all known delta types using the `KNOWN_DELTA_CLASSES` binding; LLM invoked only for novel artifact shapes not present in the binding |

## Binding Points
| Binding | Required | Purpose |
|---------|----------|---------|
| `LEGACY_RUN_PATH` | Yes | Root path of the legacy run container; used as the comparison baseline |
| `NATIVE_RUN_PATH` | Yes | Root path of the native engine run container |
| `ARTIFACT_TYPES` | Yes | Enumeration of artifact types expected in both runs; drives artifact-by-artifact comparison scope |
| `KNOWN_DELTA_CLASSES` | No | Pre-declared delta patterns with intent labels (improvement, cosmetic); used to classify known differences without human review |

## Failure Modes
| Condition | Action |
|-----------|--------|
| Legacy run container does not exist at `LEGACY_RUN_PATH` | STOP; cannot verify parity without a baseline — report and request the legacy run path |
| Native run container does not exist at `NATIVE_RUN_PATH` | STOP; cannot compare without the native run — report and request the native run path |
| Native engine did not produce an artifact declared in `ARTIFACT_TYPES` | Report as `BLOCKING_REGRESSION` with CRITICAL severity; do not fabricate data or infer what the artifact would have contained |
| Delta classification is ambiguous against `KNOWN_DELTA_CLASSES` | Label as `UNKNOWN` with a `HYPOTHESIS` (explicitly marked non-definitive) citing the specific evidence |
| Run metadata files are absent from one or both containers | Record `input_equivalence: unconfirmed`; proceed with comparison but flag prominently in the report |
| An artifact cannot be read (binary, corrupt, or access-restricted) | Record the artifact in the inventory with `content: not readable — [reason]`; classify structural presence/absence only |
