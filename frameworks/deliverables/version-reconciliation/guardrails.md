# Framework Guardrails

This document consolidates all safety rules, execution modes, and constraints for the Version Reconciliation framework. Reference this file from skills, commands, and agents via anchor links.

---

## Quick Reference Table

| Mode | Writes Files | Runs Tests | Modifies Inputs | Use Case |
|------|-------------|------------|-----------------|----------|
| FINDINGS_ONLY | No | No | No | Observe diffs and report contradictions in chat only |
| PATCH_ALLOWED | Scoped | No | Scoped | Apply reconciled content to the designated target version |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Extract, diff, and report contradictions without writing output files
- **Allowed:** Read files, extract content, compare versions, generate findings in chat
- **Forbidden:** Write any files, modify inputs, apply reconciliation patches
- **Use when:** Quick contradiction check, initial assessment, verbal diff review

### PATCH_ALLOWED
- **Purpose:** Full reconciliation pipeline including artifact generation and optional patching
- **Allowed:** Read all inputs, write to `reconciliation_output/`, apply approved changes to target version
- **Forbidden:** Modify files outside `reconciliation_output/` without explicit user confirmation
- **Use when:** Full end-to-end reconciliation, structured report generation, applying fixes

---

## 2. Observational Reporting {#observational-reporting}

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Version A states '$45,000' on slide 3; Version B states '$42,500' in Section 2.1"
- Cite evidence with exact locations: "Version A slide 7 speaker notes: 'Launch date: March 15'"
- Quantify discrepancies: "Version A lists 12 deliverables; Version B lists 14 deliverables"
- Posit hypotheses (labeled): "HYPOTHESIS: The $2,500 difference may reflect a scope reduction documented elsewhere"
- Report bidirectionally: always state what A has that B lacks AND what B has that A lacks

### What NOT to do:
- Do NOT diagnose root causes -- Don't say "Someone forgot to update the pricing"
- Do NOT prescribe which version is correct -- No "Version B is right, update A"
- Do NOT make editorial decisions -- No "The newer number is more accurate"
- Do NOT estimate revision effort -- No "This will take 20 minutes to reconcile"
- Do NOT dismiss small differences -- Every number mismatch is significant

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
| Edit suggestions | Remove entirely (unless in PATCH_ALLOWED remediation step) |
| Time estimates | Remove entirely |

### Required Labels {#required-labels}

All interpretive statements MUST use one of:

- `**Observation:**` -- Factual description of what was seen
- `**HYPOTHESIS:**` -- Labeled interpretation with evidence path citation
- `**Cross-Version Pattern:**` -- Factual comparison across the two versions
- `**Open Questions for Review:**` -- Section header for questions requiring human judgement
- `**Evidence Locations:**` -- Section header listing exact locations in both versions

---

## 3. Number Mismatch Policy {#number-mismatch}

**CRITICAL:** Every number mismatch is significant regardless of magnitude.

| Rule | Detail |
|------|--------|
| No rounding tolerance | $45,000 vs $45,001 is a CRITICAL finding |
| No percentage tolerance | 34% vs 35% is a CRITICAL finding |
| Date mismatches always critical | "March 15" vs "March 16" is CRITICAL |
| Count mismatches always critical | "12 deliverables" vs "14 deliverables" is CRITICAL |
| Unit mismatches always critical | "$45,000 CAD" vs "$45,000 USD" is CRITICAL |

---

## 4. Severity Classification {#severity-classification}

| Severity | Definition | Examples |
|----------|-----------|---------|
| CRITICAL | Any number, date, price, or factual mismatch between versions | Wrong price, different date, count mismatch, unit difference |
| MAJOR | Content present in one version but entirely absent from the other | Missing section, missing deliverable, missing speaker notes |
| MINOR | Wording difference, formatting variance, or structural reordering | Different phrasing, bullet vs paragraph, slide order change |
| INFO | Metadata differences, style variations, or additive-only content | Font change, extra whitespace, additional context in one version |

### Severity Rules:
1. ALL number mismatches are CRITICAL -- no exceptions
2. Speaker notes mismatches are treated at the same severity as body content
3. Cross-format alignment differences (e.g., heading levels mapping to slide titles) are MINOR unless content differs
4. CRITICAL findings should be prominently flagged in the contradiction report

---

## 5. Speaker Notes Policy {#speaker-notes}

Speaker notes are **first-class content**. They must be:
- Extracted from every slide in .pptx files
- Compared with the same rigor as body text
- Included in structural diff output
- Reported in the contradiction report at appropriate severity

A number in speaker notes is as significant as a number on a slide face.

---

## 6. Cross-Format Alignment {#cross-format}

When comparing documents of different formats (.pptx vs .md, .pdf vs .docx):

### Alignment Rules:
1. Map slide titles to markdown headings / PDF section headers
2. Map slide bullet points to markdown list items / document paragraphs
3. Map speaker notes to footnotes, endnotes, or supplementary text
4. Document all alignment decisions in `structural_diff.json`

### Alignment Reporting:
- Every aligned pair must record: version_a_location, version_b_location, alignment_method
- Unaligned sections must be reported as ADDED_IN_A or ADDED_IN_B
- Ambiguous alignments must be flagged with alignment_confidence

---

## 7. Bidirectional Reporting {#bidirectional}

**All diffs MUST be reported in both directions:**

1. "Version A has, Version B lacks" -- content present only in A
2. "Version B has, Version A lacks" -- content present only in B
3. "Both have, values differ" -- content present in both but with discrepancies

Reports that only show differences in one direction are incomplete and invalid.

---

## 8. Input Integrity {#input-integrity}

### Never Modify (in FINDINGS_ONLY):
- Version A file
- Version B file
- Any referenced source documents

### Scoped Modification (in PATCH_ALLOWED, Prompt 05 only):
- Only after explicit user confirmation
- Only the file designated as the reconciliation target
- Changes must be individually approved

### Read-Only Principle (Prompts 01-04):
Prompts 01 through 04 are strictly read-only. They observe, compare, and report. They never edit, correct, or "fix" any input file.

---

## 9. Evidence Standards {#evidence-standards}

### Citation Format
- Every factual claim must be backed by evidence paths in BOTH versions
- Format: `[description] at \`version_a:location\`` and `[description] at \`version_b:location\``
- Example: "Price '$45,000' at `proposal_v2.pptx:slide 3` vs '$42,500' at `proposal_v1.md:Section 2.1, line 47`"

### Provenance Check
- Every contradiction must cite the exact location in both versions
- If a fact appears in one version but not the other, cite the location where it appears and note its absence

---

## 10. Data Safety {#data-safety}

### Never Include in Reports:
- Client passwords, API keys, or credentials
- Internal pricing discussions or negotiation notes
- PII of individuals not already named in the deliverables
- Proprietary competitor information beyond what's in the deliverables

### Safe Patterns:
- Reference file paths instead of pasting large content blocks
- Quote only the specific text needed for evidence
- Use line numbers and slide numbers when referencing specific content

---

## 11. Mode-Specific Checklists {#mode-checklists}

### FINDINGS_ONLY Checklist
- [ ] No files were written to disk
- [ ] No input files were modified
- [ ] All findings presented in chat
- [ ] Evidence paths cited for all claims in both versions
- [ ] Severity assigned to each finding
- [ ] All number mismatches classified as CRITICAL
- [ ] Speaker notes included in comparison
- [ ] Bidirectional reporting (A lacks / B lacks / both differ)

### PATCH_ALLOWED Checklist
- [ ] Only `reconciliation_output/` directory was written to (Prompts 01-04)
- [ ] No input files were modified without explicit user confirmation (Prompt 05)
- [ ] All intermediate artifacts generated (extraction, diff, report)
- [ ] CONTRADICTION_REPORT.md includes all findings with severity and evidence
- [ ] reconciliation_summary.json matches report content
- [ ] All number mismatches classified as CRITICAL
- [ ] Speaker notes extracted and compared
- [ ] Bidirectional reporting throughout
- [ ] Cross-format alignment documented (if applicable)
