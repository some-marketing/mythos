---
description: Deterministically review an Mythos task plan before execution.
argument-hint: task-id or plan path
---

$ARGUMENTS

Run this deterministic command from the Mythos repository root:

```bash
npm run codex:mythos -- command "/review-task-plan $ARGUMENTS"
```

The command writes structural-precheck scratch JSON and Markdown only. Read the full plan and active amendment/repair evidence, form the substantive narrative judgment, and write the canonical review JSON and Markdown paths reported by the command. Copy the exact `narrative_completion_expected` run ID and content hashes into a `narrative_completion` object with `status: "complete"`. Add this one-line form to the canonical Markdown, replacing the placeholders with the same values: `<!-- mythos_narrative_completion: {"schema":"TaskPlanNarrativeCompletion/1.0","run_id":"<run-id>","plan_content_hash":"<sha256>","status":"complete"} -->`. Do not execute the plan. Do not report completion until the bound canonical pair exists.
