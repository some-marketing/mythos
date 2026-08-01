---
description: Create project linked to framework
mode: PATCH_ALLOWED
---

<objective>
Create a new project for a client under a specific framework, scaffolding the project directory with intake, outputs, and reports structure and linking it to the framework's prompt chain.
</objective>

<process>
- First classify intent. Continue only if the request is scaffold-only: client code, framework id, project slug, and optional workspace_root. If the request includes a work brief or execution/orchestration language, stop before file writes and return the matching redirect from scope_resolution.redirects.
- Parse arguments for client code, framework id (service/framework), project slug, and optional workspace_root.
- Validate that the client exists under clients/ and the framework exists under frameworks/.
- If workspace_root is provided, create the project inside that external workspace repo. Otherwise, create it under Mythos/clients/{code}/ (default for private operations).
- Load the manage-clients skill workflow: .claude/skills/manage-clients/SKILL.md and follow the create-project workflow.
- Create the project directory with project.json initialized with the framework reference.
- Scaffold the project intake directory with required input placeholders.
- Confirm creation by listing the new project structure.
</process>

<success_criteria>
- Project directory created with correct naming convention
- project.json initialized with framework reference
- Project intake directory scaffolded with required input placeholders
- Framework reference points to an existing registered framework
</success_criteria>

<handoff>
project_created: run-framework <service/framework> <project-root>
execution_brief_detected: owl <target-or-work-brief>
planning_brief_detected: plan-task --scope <system|client> "<work brief>"
framework_not_found: list-frameworks
client_not_found: new-client <client-code> <client-name>
</handoff>
