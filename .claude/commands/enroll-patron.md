---
description: Enroll a patron — register a new client in Mythos
argument-hint: <client-code> <client-name>
allowed-tools: [Read, Write, Glob]
---

> Authority: `new-client` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Enroll a patron (register a new client) in Mythos by invoking the `manage-clients` essence (skill).
</objective>

<process>
1. Parse $ARGUMENTS for patron name and code. If missing, prompt the user.
2. Read and follow the essence workflow:

@.claude/skills/manage-clients/SKILL.md

Follow the `create-client` workflow.
</process>

<success_criteria>
- Patron directory created at clients/{code}/
- Patron metadata file initialized
- Patron registered in Mythos CLAUDE.md
</success_criteria>
