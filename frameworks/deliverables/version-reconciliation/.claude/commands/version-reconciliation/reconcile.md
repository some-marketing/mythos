---
name: reconcile
description: Run full version reconciliation pipeline — extract, diff, report, and optionally apply changes
skill: version-reconciliation
mode: PATCH_ALLOWED
arguments:
  - name: version_a
    description: Path to first version of the deliverable
    required: true
  - name: version_b
    description: Path to second version of the deliverable
    required: true
  - name: source_of_truth
    description: "Which version is authoritative: 'a' or 'b' (default: neither)"
    required: false
---

Run the full version reconciliation pipeline.

1. Load `guardrails.md` for execution constraints
2. Validate both files exist and detect formats
3. Extract structured content from both versions (including speaker notes)
4. Align sections and produce structural diff
5. Generate contradiction report with provenance citations
6. Present contradictions for user review
7. If user approves reconciliation items, apply changes to designated version
8. Write all artifacts to `reconciliation_output/`

Follow `guardrails.md` — every number mismatch is CRITICAL.
