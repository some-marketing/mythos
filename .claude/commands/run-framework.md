---
description: Execute framework prompt chain
mode: COORDINATOR
---

<objective>
Execute a framework's prompt chain against a client project with guardrail enforcement, mode-per-prompt enforcement, output validation, and completion auditing.
</objective>

<process>
- Parse arguments for framework id (service/framework, e.g., wordpress/qa) and project root path (recommended: workspace project under <WORKSPACE_ROOT>/projects/...).
- Confirm the project has completed intake. If intake is incomplete, run the intake workflow first.
- Load the framework's guardrails from frameworks/{service}/{framework}/guardrails.md and the manifest from frameworks/{service}/{framework}/manifest.json.
- Set execution mode per each prompt's declaration and enforce it throughout the chain.
- Load and follow the execute-framework skill workflow: .claude/skills/execute-framework/SKILL.md, following the execute workflow which chains to the review workflow for output validation and completion auditing.
- Execute prompts in the order declared by the manifest's prompt chain.
- After execution, run the review workflow to validate outputs and perform completion auditing.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Execution modes enforced per prompt declaration
- All outputs written to the project directory
- Guardrails enforced throughout execution
- Completion auditor confirms no blocker-level findings for multi-prompt runs
</success_criteria>

<orchestration_rules>
- Execute prompts in manifest-declared order.
- Enforce the execution mode declared by each individual prompt.
- Never skip guardrail checks.
- Completion auditor must confirm no blocker-level findings for multi-prompt runs.
</orchestration_rules>

<handoff>
execution_complete: project-status <client-code/project-name>
blocker_found: review-progress <project-root>
intake_incomplete: new-project <client-code> <service/framework> <project-slug>
</handoff>
