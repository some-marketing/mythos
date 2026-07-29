# 09 — Bundle Consolidation

## Type
Atomic

## Execution Mode
PATCH_ALLOWED — implement the bundle assembler module and write validated bundle artifacts scoped to the target framework's output directory. Do not modify source evidence files or other framework files.

## Purpose
Consolidate multiple artifact generation paths into a single descriptor-driven bundling system. A bundle is a self-contained package of artifacts for handoff to another system or person. It includes a manifest, evidence, reports, and entry-point instructions for consuming the bundle. This prompt replaces ad-hoc bundle construction with a canonical format driven by a reusable descriptor schema.

---

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `docs/ARTIFACT_CONTRACT.md` | Yes | Canonical source for bundle structure, required contents, and artifact naming |
| Run evidence | Yes | Evidence files produced during execution runs, to be packaged into bundles |
| Reports | Yes | Output reports (markdown and JSON) produced by prior pipeline stages |
| Existing bundle generation code | No | Any current bundling logic in the target framework's runner directory, for parity review |
| `BUNDLE_TYPES` binding | Yes | List of named bundle types the framework produces (e.g., handoff bundle, archive bundle, review package) |
| `BUNDLE_DESCRIPTOR_SCHEMA` binding | Yes | Schema definition for the descriptor format that drives bundle assembly |
| `ENTRY_POINT_TEMPLATE` binding | Yes | Template for the entry-point instructions document written into every bundle |

---

## Process

### Step 1: Read ARTIFACT_CONTRACT.md [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md`
2. Extract the bundle structure definition:
   - Required bundle contents per bundle type
   - Manifest file naming convention and required fields
   - Bundle root directory naming pattern
   - Entry-point document name and location within the bundle
3. If `docs/ARTIFACT_CONTRACT.md` does not exist, STOP and report that contract definition (Prompt 01) must be completed first

### Step 2: Inventory Existing Bundle Generation Paths [AUTO]
1. Inspect the target framework's runner directory for any existing bundling or packaging code
2. For each generation path found, record:
   - What artifacts it collects
   - What output structure it produces
   - Whether it writes a manifest
   - Whether it validates completeness before packaging
3. If multiple generation paths exist, identify overlaps, divergences, and any gaps relative to the ARTIFACT_CONTRACT
4. If no existing bundling code is found, record that this is a greenfield implementation and proceed

### Step 3: Design the Canonical Bundle Descriptor Format [AUTO]
Using the `BUNDLE_DESCRIPTOR_SCHEMA` binding as the authoritative definition, confirm the descriptor format can express the following for every bundle type declared in `BUNDLE_TYPES`:

1. **Bundle identity**: name, type, version, generation timestamp
2. **Content manifest**: list of artifact paths with roles (evidence, report, metadata, entry-point)
3. **Validation rules**: required artifacts per bundle type; optional artifacts and conditions under which they are expected
4. **Entry-point reference**: path to the document a consumer reads first

If the `BUNDLE_DESCRIPTOR_SCHEMA` binding does not cover any of the above, record the gap as an open question before proceeding to implementation.

### Step 4: Implement the Descriptor-Driven Assembler [AUTO]
Implement the bundle assembler as a callable module with the following behavior:

**Input: a bundle descriptor**
- Read the descriptor and extract: bundle type, content manifest, validation rules, entry-point reference
- Verify that the bundle type is registered in the `BUNDLE_TYPES` binding

**Collection phase:**
- For each artifact in the content manifest, locate the artifact at its declared path
- If a required artifact is missing, record a collection error and do not proceed to packaging
- If an optional artifact is missing, record a warning and continue

**Validation phase:**
- Confirm that all required artifacts per the bundle type's validation rules are present and non-empty
- Confirm that no artifacts are orphaned (present in the output directory but absent from the descriptor)
- Orphaned artifacts are reported as observations, not errors — they do not block assembly

**Packaging phase:**
- Assemble all collected artifacts into the bundle root directory
- Write the manifest file using the naming convention from `docs/ARTIFACT_CONTRACT.md`

### Step 5: Generate Required Manifest Files [AUTO]
For every assembled bundle, write two manifest artifacts:

**Content index** — a machine-readable manifest file in the bundle root:
```json
{
  "bundle_id": "...",
  "bundle_type": "...",
  "generated_at": "ISO-8601",
  "descriptor_version": "...",
  "contents": [
    {
      "path": "relative/path/within/bundle",
      "role": "evidence|report|metadata|entry_point|supporting",
      "required": true
    }
  ],
  "validation_status": "VALID|INCOMPLETE|ORPHANED_ARTIFACTS",
  "validation_notes": []
}
```

**Entry-point document** — a human-readable instructions file written using the `ENTRY_POINT_TEMPLATE` binding. This document tells a consumer:
- What the bundle contains and its purpose
- Which file to read first
- How to navigate from the entry point to detailed evidence and reports
- Any prerequisites for consuming the bundle

### Step 6: Validate Every Bundle Against Its Descriptor [AUTO]
After assembly and manifest generation, perform a final validation pass on each bundle:

1. Verify that every artifact listed in the content index exists at its declared path within the bundle
2. Verify that the bundle contains no artifacts not listed in the content index
3. Verify that the entry-point document is present and non-empty
4. Verify that the validation_status field accurately reflects the result of Steps 4-5
5. If any validation check fails, update the validation_status and validation_notes; do not silently pass an invalid bundle

### Step 7: Review One Generated Bundle [USER]
1. Present the user with one complete bundle (the most recently assembled bundle or a representative example):
   - Show the bundle directory structure
   - Show the content index with artifact roles
   - Show the first section of the entry-point document
2. Ask the user to confirm:
   - That the bundle contents are complete for a real handoff
   - That the entry-point document gives a consumer enough context to begin
   - That no required artifacts are missing or misclassified
3. STOP and wait for user response before proceeding to Step 8
4. If the user identifies gaps, record them as open questions; do not modify the descriptor schema without explicit instruction

### Step 8: Write the Assembler Module [AUTO]
1. Assemble all collection, validation, and packaging logic from Steps 4–6 into a single assembler module
2. Expose a generation entry point that accepts:
   - A bundle descriptor as input
   - An output directory path
3. The module must be independently testable: given a descriptor and a directory of artifacts, it must produce a deterministic bundle
4. Write the module to the path declared in `docs/ARTIFACT_CONTRACT.md` under the runner directory
5. Write a brief inline comment at the top of the module citing the ARTIFACT_CONTRACT.md section and the `BUNDLE_DESCRIPTOR_SCHEMA` binding it implements

---

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| Assembler module | Runner directory (per ARTIFACT_CONTRACT.md) | Code implementing descriptor-driven bundle assembly, validation, and packaging |
| Bundle descriptor schema | Per ARTIFACT_CONTRACT.md or schemas directory | Formal schema definition for bundle descriptors |
| Validated bundles | Bundle root directories (per ARTIFACT_CONTRACT.md) | One or more complete bundles assembled and validated during this prompt |

---

## Graduation Path

| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM reads artifact directories and assembles bundles by hand; writes manifests from observation |
| L1 | Verified | Verification checks confirm that each bundle contains all required files per its descriptor; orphaned artifacts are flagged |
| L2 | Coded | Assembler module exists as stable code; bundle generation is deterministic given the same descriptor and artifact inputs |
| L3 | Code-owned | Code generates and validates all bundles; LLM is invoked only to write the entry-point narrative for novel bundle types |
| L4 | Mechanical | Fully mechanical bundling including entry-point generation; LLM invoked only when the bundle descriptor schema changes and new field types need interpretation |

---

## Binding Points

| Binding | Required | Purpose |
|---------|----------|---------|
| `BUNDLE_TYPES` | Yes | Named list of bundle types the framework produces; each type has a distinct set of required and optional contents |
| `BUNDLE_DESCRIPTOR_SCHEMA` | Yes | Schema definition for the descriptor format that drives assembly; defines all fields the assembler reads and validates |
| `ENTRY_POINT_TEMPLATE` | Yes | Template for the entry-point instructions document written into every bundle; must include placeholders for bundle identity, purpose, and navigation instructions |

---

## Failure Modes

| Condition | Action |
|-----------|--------|
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| `BUNDLE_TYPES` binding is empty | STOP; cannot assemble bundles without declared bundle types |
| `BUNDLE_DESCRIPTOR_SCHEMA` binding is not supplied | STOP; no schema means no deterministic assembly |
| `ENTRY_POINT_TEMPLATE` binding is not supplied | STOP; bundles without entry-point documents are not self-contained |
| A required artifact is missing during collection | Record as a collection error; do not package an incomplete bundle; report to user |
| Bundle contains orphaned artifacts | Report as observation; include in validation_notes; do not block assembly |
| Multiple existing generation paths produce conflicting bundles | Report the conflict as an observation; do not auto-resolve; ask user which path should be canonical |
| User identifies gaps in Step 7 | Record as open questions; do not modify descriptor schema without explicit instruction |
