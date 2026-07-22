# Framework Guardrails

This document consolidates all safety rules, execution modes, and constraints for the Presentation Review framework. Reference this file from skills, commands, and agents via anchor links.

---

## Quick Reference Table

| Mode | Writes Files | Runs Tests | Modifies Inputs | Use Case |
|------|-------------|------------|-----------------|----------|
| FINDINGS_ONLY | No | No | No | Observe and document only |
| REVIEW_ONLY | Reports only | No | No | Analyze existing artifacts |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Observe presentation and source documents, report findings in chat
- **Allowed:** Read files, view images, analyze content, generate findings in chat
- **Forbidden:** Write any files, modify inputs, create reports on disk
- **Use when:** Quick verbal audit, initial assessment, exploratory review

### REVIEW_ONLY
- **Purpose:** Produce structured audit report artifacts from analysis
- **Allowed:** Read all inputs, view screenshots, write analysis reports to `audit_output/`
- **Forbidden:** Modify any input files (presentation, source docs, screenshots)
- **Use when:** Full end-to-end audit, structured report generation

---

## 2. Observational Reporting {#observational-reporting}

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Slide 5 lists 6 locations with checkmarks"
- Describe what you expected: "Expected: 5 CLIENTB locations per scope doc Section 4"
- Cite evidence with file paths: "Scope doc states '$23,500 CAD' at `ECH_Project_Scope:line 412`"
- Quantify discrepancies: "Slide states '19 years'; scope doc says 'practising since 1999' = 27 years"
- Posit hypotheses (labeled): "HYPOTHESIS: The extra checkmark item may be a section heading misread as a location entry"
- Compare sources: "Presentation uses Zocdoc 2024 data; Gemini prompt suggested BrightLocal healthcare data"

### What NOT to do:
- Do NOT diagnose root causes -- Don't say "The problem is Taylor forgot to update this"
- Do NOT suggest presentation edits -- No "Change slide 5 to show 5 checkmarks instead of 6"
- Do NOT prescribe design changes -- No "Move the pricing to slide 9 instead of slide 12"
- Do NOT make editorial decisions -- No "The Zocdoc source is better than BrightLocal"
- Do NOT estimate revision effort -- No "This will take 30 minutes to fix"

### Forbidden Labels and Patterns {#forbidden-labels}

Reports must contain **ZERO** instances of:

| Forbidden | Replace With |
|-----------|-------------|
| `Root Cause:` | `Observation:` + `HYPOTHESIS:` |
| `Recommendation:` | `Open Questions for Review` |
| `Action Required:` | `Evidence Locations:` |
| `Fix:` or `Change to:` | `Observation:` (describe the discrepancy) |
| `Confidence Level: HIGH` | Remove entirely -- let evidence speak |
| Priority labels (`P0`, `P1`, `P2`) | Use severity: CRITICAL / MAJOR / MINOR / INFO |
| Edit suggestions | Remove entirely |
| Time estimates | Remove entirely |

### Required Labels {#required-labels}

All interpretive statements MUST use one of:

- `**Observation:**` -- Factual description of what was seen
- `**HYPOTHESIS:**` -- Labeled interpretation with evidence path citation
- `**Cross-Source Pattern:**` -- Factual comparison across documents
- `**Open Questions for Review:**` -- Section header for questions requiring human judgement
- `**Evidence Locations:**` -- Section header listing file paths

---

## 3. Severity Classification {#severity-classification}

| Severity | Definition | Examples |
|----------|-----------|---------|
| CRITICAL | Factual error that could mislead the client or misrepresent scope | Wrong price, incorrect timeline, factual claim contradicted by source docs |
| MAJOR | Missing spec'd content or unapplied correction from errata | Screenshot missing from manifest, correction from errata not applied |
| MINOR | Wording difference, layout variance, or non-material discrepancy | Different phrasing than spec, extra whitespace, slide ordering different from spec |
| INFO | Extra content not in spec, orphaned files, style observations | Additional source cited, screenshot present but not in manifest, branding note |

### Severity Rules:
1. Severity is based on client impact, not ease of fix
2. A single slide can have multiple findings at different severities
3. CRITICAL findings should halt the audit summary with a prominent flag
4. INFO findings are included for completeness but do not affect the overall verdict

---

## 4. Input Integrity {#input-integrity}

### Never Modify:
- The presentation file (.pptx)
- Source documents (scope, proposal, tech spec, etc.)
- Screenshots
- Errata/corrections files

### Read-Only Principle:
This framework is strictly read-only with respect to all inputs. The audit process observes, compares, and reports. It never edits, corrects, or "fixes" the presentation or source materials.

---

## 5. Evidence Standards {#evidence-standards}

### Citation Format
- Every factual claim must be backed by an evidence path
- Format: `[description] at \`filename:line\`` or `[description] on slide N`
- Example: "Price '$23,500 CAD' at `ECH_Website_Rebuild_Proposal.md:line 87`"
- Example: "Performance score '34/100' on slide 6, verified in `Screenshots/ECH__pagespeed-34-performance.png`"

### Screenshot Verification
- Screenshots must be visually verified using the Read tool (multimodal)
- Report what the screenshot shows, not what the manifest says it shows
- Note annotations, highlights, callouts, and their accuracy

### Uncertainty Labels
- `FACT` -- Directly observed in source document or presentation
- `HYPOTHESIS` -- Interpretation based on evidence
- `UNKNOWN` -- Cannot be determined from available evidence
- `VISUAL_MATCH` -- Screenshot visually matches its manifest description
- `VISUAL_MISMATCH` -- Screenshot does not match its manifest description

---

## 6. PPTX Extraction {#pptx-extraction}

### Extraction Priority:
1. **python-pptx** -- Preferred method. Use if Python and python-pptx are available
2. **Read tool** -- Claude Code's multimodal Read tool can read .pptx files directly
3. **ZIP decompress + XML parse** -- Fallback: .pptx is a ZIP; extract and parse `ppt/slides/slide*.xml`

### Extraction Requirements:
- Extract ALL slides (do not skip blank or image-only slides)
- Capture: slide number, title text, body text, speaker notes, image references
- Note image dimensions and positions where available
- Record total slide count

---

## 7. Subagent Rules {#subagent-rules}

### Delegation Language
> **Subagent delegation (optional):** If your environment supports subagents, delegate the sub-tasks listed below in parallel. Otherwise, execute them sequentially in the order listed. Subagents must follow the same guardrails and evidence rules as the parent prompt.

### Standard Subagent Roles
| Role | Purpose |
|------|---------|
| Discovery Agent | Inventory project directory, classify files by role |
| Extraction Agent | Extract presentation content into structured format |
| Slide Auditor | Cross-reference slide content against source documents |
| Screenshot Auditor | Validate screenshots against manifest and slide placement |
| Report Agent | Assemble findings into structured audit report |

### Subagent Constraints
- Each subagent receives only the files it needs (narrow scope)
- Subagents must not modify any input files
- Subagents must reference evidence paths correctly
- The manager/parent verifies subagent outputs before integrating

---

## 8. Data Safety {#data-safety}

### Never Include in Reports:
- Client passwords, API keys, or credentials
- Internal pricing discussions or negotiation notes
- PII of individuals not already named in the presentation
- Proprietary competitor information beyond what's in the presentation

### Safe Patterns:
- Reference file paths instead of pasting large content blocks
- Quote only the specific text needed for evidence
- Use line numbers when referencing specific content

---

## 9. Mode-Specific Checklists {#mode-checklists}

### FINDINGS_ONLY Checklist
- [ ] No files were written to disk
- [ ] No input files were modified
- [ ] All findings presented in chat
- [ ] Evidence paths cited for all claims
- [ ] Severity assigned to each finding

### REVIEW_ONLY Checklist
- [ ] Only `audit_output/` directory was written to
- [ ] No input files were modified
- [ ] All intermediate artifacts generated (intake, extraction, index, findings)
- [ ] Final report includes executive summary
- [ ] All findings have severity and evidence paths
- [ ] Screenshot verification results included
- [ ] Corrections/errata check results included
