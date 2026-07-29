# Presentation Review: {{CLIENT_NAME}}

## Setup

- **Presentation:** `{{PRESENTATION_FILE}}`
- **Project Directory:** `{{PROJECT_DIRECTORY}}`
- **Audit Date:** {{AUDIT_DATE}}
- **Reviewer:** Claude Code (presentation-review framework v1.0.0)

## Pre-Audit Checklist

- [ ] Presentation file (.pptx) accessible
- [ ] Project directory contains source documents
- [ ] Screenshots directory present (if applicable)
- [ ] Errata/corrections file identified (if applicable)

## Commands

### Full End-to-End Audit
```
/presentation-review:review {{PRESENTATION_FILE}} {{PROJECT_DIRECTORY}}
```

### Individual Steps
```
/presentation-review:extract {{PRESENTATION_FILE}}
/presentation-review:audit-slides
/presentation-review:audit-screenshots
/presentation-review:report
/presentation-review:status
```

## Expected Output

After the audit completes, find all artifacts in:
```
{{PROJECT_DIRECTORY}}/audit_output/
├── intake_manifest.json
├── presentation_content.json
├── source_document_index.json
├── slide_findings.json
├── screenshot_findings.json
├── corrections_findings.json
├── gap_analysis.json
├── gap_analysis.md
├── AUDIT_REPORT.md          <-- Primary deliverable
└── audit_summary.json       <-- Machine-readable summary
```

## Review Checklist (Post-Audit)

- [ ] Read AUDIT_REPORT.md executive summary
- [ ] Review any CRITICAL findings
- [ ] Review any MAJOR findings
- [ ] Check screenshot completeness
- [ ] Check corrections compliance
- [ ] Address open questions
- [ ] Share findings with presentation author
