---
description: Validate and normalize a capture bundle
mode: PATCH_ALLOWED
---

<objective>
Check whether a capture bundle has enough structured evidence to be marked ready for candidate scaffolding, update its metadata with normalization status, and produce a normalization report listing any missing or incomplete items.
</objective>

<process>
- Parse arguments for <capture-root>. If missing, prompt the user.
- Read the capture bundle: load CAPTURE_META.json, goal.md, context.md, steps.jsonl, decisions.jsonl, and success_criteria.json from the capture root.
- Check completeness: confirm each required file exists and contains non-placeholder, substantive content. Verify steps.jsonl has at least one step entry, success_criteria.json has at least one criterion, and goal.md describes a concrete outcome.
- Check imported evidence: verify artifacts/imported/ contains at least one file or directory of source material.
- Update readiness in CAPTURE_META.json: set ready_for_scaffold to true only if all required structure is complete; otherwise set it to false with a list of missing items.
- Write NORMALIZATION_REPORT.md in the capture root with: normalization timestamp, completeness checklist (pass/fail per field), missing items with specific guidance, and advisory notes for improvement.
- Report normalization results to the user: pass/fail status, missing items if any, and recommended next steps.
</process>

<success_criteria>
- Capture metadata updated with normalization status and ready_for_scaffold flag
- NORMALIZATION_REPORT.md created in the capture root
- Missing required items clearly listed if the capture is incomplete
- User receives a clear pass/fail summary with next steps
</success_criteria>

<handoff>
capture_ready: scaffold-framework <project-root> <capture-id>
capture_incomplete: User fixes missing items, then re-run normalize-capture
check_status: capture-status <capture-root>
</handoff>
