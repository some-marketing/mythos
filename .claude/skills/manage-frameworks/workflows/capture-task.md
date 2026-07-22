# Capture Task Workflow

## Steps

1. **[USER] Identify successful work** — Choose the project root, task type, and the source material to import.
2. **[AUTO] Import evidence** — Copy files or folders into `captures/<capture_id>/artifacts/imported/`.
3. **[AUTO] Initialize capture bundle** — Create `CAPTURE_META.json`, `goal.md`, `context.md`, `steps.jsonl`, `decisions.jsonl`, and `success_criteria.json`.
4. **[USER] Fill required structure** — Complete the goal, context, step log, and success criteria with non-placeholder content.
5. **[AUTO] Validate current completeness** — Report which required pieces are still missing before normalization can mark the capture ready.

## Output

- New capture directory under `<project-root>/captures/<capture_id>/`
- Imported evidence under `artifacts/imported/`
- Initial readiness summary
