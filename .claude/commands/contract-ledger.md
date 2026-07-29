---
description: Contract ledger — check the status of a patron contract (project)
argument-hint: <client-code/project-name> | <project-root>
allowed-tools: [Read, Glob, Grep]
---

> Authority: `project-status` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Read the contract ledger (check project status) by scanning its directory structure and metadata.
</objective>

<process>
1. Parse $ARGUMENTS:
   - If it looks like a path to a directory containing `project.json`, treat it as `<project-root>` (workspace contract recommended).
   - Otherwise parse `client-code/project-name` (legacy layout).
2. Read the contract's `project.json` and scan its directory structure under the resolved contract root.
3. Check `intake/` — are all required inputs present?
4. Check `outputs/` — are execution outputs present?
5. Check `reports/` — are review (trial) reports present?
6. Report current status (intake, executing, review, complete).
</process>

<success_criteria>
- Contract status accurately determined from directory contents
- Missing inputs or outputs clearly identified
- Current phase reported to user
</success_criteria>
