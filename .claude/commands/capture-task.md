---
description: Import successful work into a normalized capture bundle
mode: PATCH_ALLOWED
---

<objective>
Import successful work from anywhere on disk into a structured capture bundle under the target project root, initializing all required metadata files so the bundle can later be normalized and used to scaffold a framework candidate.
</objective>

<process>
- Parse arguments for source path (--from), destination project root (--into), task type (--task-type), and source mode (--source manual|llm|hybrid). If required arguments are missing, prompt the user.
- Validate the source path exists and contains importable evidence (files, directories, or outputs from successful work).
- Generate a capture ID and create the capture directory under <project-root>/captures/<capture_id>/.
- Copy source evidence into captures/<capture_id>/artifacts/imported/, preserving directory structure.
- Initialize the capture bundle metadata files: CAPTURE_META.json (with capture_id, task_type, source, created_at, status), goal.md, context.md, steps.jsonl, decisions.jsonl, and success_criteria.json.
- Populate initial content in goal.md and context.md from available source material; leave placeholders only where information is genuinely unavailable.
- Validate current completeness by checking which required pieces contain non-placeholder content and which still need user input.
- Report a capture readiness summary listing completed fields, missing fields, and next steps for the user.
</process>

<success_criteria>
- New capture bundle created under <project-root>/captures/<capture_id>/
- Imported evidence copied into artifacts/imported/
- All required metadata files initialized (CAPTURE_META.json, goal.md, context.md, steps.jsonl, decisions.jsonl, success_criteria.json)
- Capture readiness summary produced with clear indication of missing fields
</success_criteria>

<handoff>
capture_complete: normalize-capture <capture-root>
capture_incomplete: User fills missing fields, then normalize-capture
check_readiness: capture-status <capture-root>
</handoff>
