---
description: Report capture readiness and missing fields
mode: REVIEW_ONLY
---

<objective>
Show whether a capture bundle is ready to scaffold from and what is still missing if it is not, without modifying any files.
</objective>

<process>
- Parse arguments for <capture-root>. If missing, prompt the user.
- Read capture metadata: load CAPTURE_META.json from the capture root.
- Inspect capture files: check for the existence and content quality of goal.md, context.md, steps.jsonl, decisions.jsonl, and success_criteria.json. Count imported evidence files under artifacts/imported/.
- Evaluate readiness: determine whether the capture meets scaffold-ready criteria based on file presence, content completeness, step count, and success criteria count.
- Report readiness to the user: show scaffold-ready status (yes/no), list any missing or incomplete fields, count of imported evidence items, and recommended next actions.
</process>

<success_criteria>
- Capture metadata read without modification
- All required fields inspected for presence and content quality
- Clear readiness verdict reported (scaffold-ready or not)
- Missing fields listed with specific guidance if capture is incomplete
</success_criteria>

<handoff>
capture_ready: scaffold-framework <project-root> <capture-id>
capture_incomplete: User fills missing fields, then normalize-capture
needs_normalization: normalize-capture <capture-root>
</handoff>
