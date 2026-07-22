# Version Reconciliation: {{CLIENT_NAME}}

Project: `{{PROJECT_NAME}}`

## What This Does

Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison (.md, .docx, .pptx, .pdf).

## Pre-Reconciliation Checklist

- [ ] Version A placed in `intake/`
- [ ] Version B placed in `intake/` (may differ in format from Version A)
- [ ] Source of truth identified (a, b, or neither)
- [ ] Focus sections identified (if applicable)

## How to Run

### Full Reconciliation
```
/version-reconciliation:reconcile intake/<version_a> intake/<version_b>
```

### Check Status
```
/version-reconciliation:status
```

## Expected Output

```
reconciliation_output/
├── CONTRADICTION_REPORT.md        <-- Primary deliverable
├── reconciliation_summary.json    <-- Machine-readable summary
└── reconciliation_log.json        <-- Detailed diff log
```

## Review Checklist (Post-Reconciliation)

- [ ] Read CONTRADICTION_REPORT.md summary
- [ ] Review any CRITICAL contradictions
- [ ] Review any MAJOR contradictions
- [ ] Check for formatting-only differences vs. content differences
- [ ] Decide which version's claims to adopt for each contradiction
- [ ] Share findings with document authors
