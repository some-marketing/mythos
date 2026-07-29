---
description: Scribe a grimoire — scaffold a framework candidate from normalized captures
argument-hint: <project-root> <capture-id[,capture-id...]> --service <service> --name <framework-name>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

> Authority: `scaffold-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Scribe a grimoire draft: generate a framework candidate (rank Iron) and draft `proposed_framework/` from one or more normalized capture bundles (refined spoils).
</objective>

<process>
1. Parse `$ARGUMENTS` for project root, capture IDs, service, and framework name.
2. Run:

`npm run workspace:candidate:scaffold -- --project <project-root> --captures <capture-id[,capture-id...]> --service <service> --name <framework-name>`

If `--service` is omitted, the candidate defaults into the **homebrew** service category (`frameworks/homebrew/<name>/`) rather than a shared one — this default is read from local configuration at scaffold time, not hardcoded, so a repository that never sets it behaves exactly as if the default didn't exist. Naming `--service` explicitly always overrides the default. See [`docs/homebrew/README.md`](../../docs/homebrew/README.md) for the full rule.

3. Follow the `scaffold-framework` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>
