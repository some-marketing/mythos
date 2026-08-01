---
description: Evaluate a source document against the source-status ladder and minimum source-document contract
mode: REVIEW_ONLY
---

<objective>
Assess whether a _dev source document is exploratory, reviewed, promotion_ready, or promoted. Report provenance gaps, unresolved conflicts, and promotion readiness without auto-promoting anything.
</objective>

<process>
- Read the source-material QA policy at _dev/policies/source-material-qa.md to load the source-status ladder and minimum source-document contract.
- Read the target document specified in arguments.
- Assess the document against the minimum source-document contract: check for purpose, provenance, key observations/decisions, open questions/unresolved conflicts, promotion targets, recommended next action, and current status.
- Classify the document using the source-status ladder: exploratory, reviewed, promotion_ready, or promoted.
- Identify provenance gaps: where does the document lack traceability to sessions, research, operator decisions, or prior docs?
- Identify unresolved conflicts: does the document contradict other known _dev documents? Are internal contradictions acknowledged?
- Distinguish structural findings (missing sections, absent fields) from judgment findings (provenance quality, readiness timing, specificity sufficiency).
- Produce a promotion readiness assessment: what would need to change for this document to reach the next status level?
- Report findings to the user in this order: status classification, structural findings, judgment findings, promotion readiness assessment, recommended next action.
</process>

<success_criteria>
- Source document read and assessed against the source-status ladder
- Status classification reported with reasoning
- Provenance gaps identified when present
- Unresolved conflicts surfaced when present
- Structural findings separated from judgment findings
- Promotion readiness assessment provided
- No modifications made to the source document
</success_criteria>

<handoff>
promotion_ready_doc: author-prompt-system <source-path>
needs_more_development: No command — operator develops the document further
needs_concept_brief: Operator creates a Dart parent Brief per the concept layer lifecycle
</handoff>
