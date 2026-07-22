---
description: Cast a grimoire — execute a framework's prompt chain against a patron contract
argument-hint: <service/framework> <project-root>
allowed-tools: [Read, Write, Edit, Glob, Grep, Task]
---

> Authority: `run-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Cast a grimoire (run a framework's prompt chain) against a patron contract (client project) by invoking the `execute-framework` essence (skill).
</objective>

<process>
1. Parse $ARGUMENTS for:
   - grimoire id: `<service/framework>` (e.g., `wordpress/qa`)
   - contract root path: `<project-root>` (recommended: a workspace project under `<WORKSPACE_ROOT>/projects/...`)
   Resolve the grimoire operand through the alias registry (the canonical registry first, then the user overlay at `$MYTHOS_HOME/aliases.yaml`, within this command's `frameworks` domain) to a canonical `service/framework` id before acting — `resolveAlias('frameworks', <operand>)` in `tools/user/resolve-alias.cjs` (e.g. `qa` resolves to `wordpress/qa`).
2. Confirm the contract has completed intake (or run intake workflow first).
3. Load the grimoire's guardrails from `frameworks/{service}/{framework}/guardrails.md`.
4. Set execution mode per each prompt's declaration and enforce it.
5. Read and follow the essence workflow:

@.claude/skills/execute-framework/SKILL.md

Follow the `execute` workflow, which chains to the `review` workflow for output validation and completion auditing.
</process>

<success_criteria>
- Grimoire prompt chain executed in correct order
- Execution modes enforced per prompt declaration
- All outputs written to the contract directory
- Completion auditor confirms no blocker-level findings (for multi-prompt runs)
</success_criteria>
