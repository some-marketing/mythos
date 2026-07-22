---
description: Open a contract — create a new project for a patron under a specific grimoire
argument-hint: <client-code> <service/framework> <project-slug> [workspace_root]
allowed-tools: [Read, Write, Glob, Task]
---

> Authority: `new-project` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Open a contract (create a new project) for a patron under a specific grimoire by invoking the `manage-clients` essence (skill).
</objective>

<process>
1. Parse $ARGUMENTS for patron code, grimoire id (`service/framework`), contract slug, and optional `workspace_root`.
   - If `workspace_root` is provided, create the contract inside that external workspace repo (recommended).
   - Otherwise, create it under `clients/{code}/` (legacy).
2. Read and follow the essence workflow:

@.claude/skills/manage-clients/SKILL.md

Follow the `create-project` workflow.
</process>

<success_criteria>
- Contract directory created with correct naming convention
- project.json initialized with grimoire reference
- Contract intake directory scaffolded
</success_criteria>
