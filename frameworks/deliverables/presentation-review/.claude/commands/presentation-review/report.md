---
description: Assemble final audit report from all findings
allowed-tools: Task, Read, Glob, Grep
---

<objective>
Synthesize all finding artifacts into a gap analysis and assemble the final
AUDIT_REPORT.md with executive summary, slide-by-slide findings, and evidence index.
</objective>

<process>
1. **Verify prerequisites**
   - Check that `audit_output/slide_findings.json` exists.
   - Check that `audit_output/screenshot_findings.json` exists (optional).
   - Check that `audit_output/corrections_findings.json` exists (optional).
   - At minimum, slide_findings.json must exist. If missing, inform user to run audits first. STOP.

2. **Execute gap analysis**
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/07_GAP_ANALYSIS_AND_SYNTHESIS.md`
   - Aggregate findings, identify patterns, assign verdict.
   - Write gap_analysis.json and gap_analysis.md.

3. **Assemble report**
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/08_AUDIT_REPORT_ASSEMBLY.md`
   - Write AUDIT_REPORT.md and audit_summary.json.
   - Delegate to report-agent if using subagents.

4. **Present results**
   - Overall verdict
   - Key metrics (pass rate, screenshot completeness, corrections compliance)
   - CRITICAL and MAJOR findings listed inline
   - Path to AUDIT_REPORT.md
</process>

<context>
Prompts: `frameworks/deliverables/presentation-review/prompts/07_GAP_ANALYSIS_AND_SYNTHESIS.md`,
         `frameworks/deliverables/presentation-review/prompts/08_AUDIT_REPORT_ASSEMBLY.md`
Guardrails: `frameworks/deliverables/presentation-review/guardrails.md#forbidden-labels`
Mode: REVIEW_ONLY
</context>

<success_criteria>
- AUDIT_REPORT.md written with all available findings integrated
- audit_summary.json written with machine-readable metrics
- Verdict assigned with rationale
- No forbidden labels in report
- Report is self-contained
</success_criteria>
