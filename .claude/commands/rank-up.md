---
description: Rank up — promote a validated framework candidate into Mythos
argument-hint: <candidate-root>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

> Authority: `promote-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Rank up a candidate grimoire: promote a validated candidate into `frameworks/`, register it canonically, and regenerate managed instruction files. This is the step that carries a grimoire from Iron (candidate) toward Bronze/Silver.
</objective>

<process>
1. Parse `$ARGUMENTS` for `<candidate-root>`. When the operand is a short grimoire name rather than a path, resolve it through the alias registry (the canonical registry first, then the user overlay at `$MYTHOS_HOME/aliases.yaml`, within this command's `frameworks` domain) to a canonical `service/framework` id before acting — `resolveAlias('frameworks', <operand>)` in `tools/user/resolve-alias.cjs`.
2. Run:

`npm run workspace:candidate:promote -- --candidate <candidate-root>`

Promotion validates the service category the candidate already carries — a candidate scaffolded into `frameworks/homebrew/<name>/` (the default when `/scribe-grimoire` ran without an explicit `--service`) stays in homebrew through promotion; a candidate scaffolded under a shared category stays there too. Promotion never silently rewrites a candidate's service category.

3. Follow the `promote-framework` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>
