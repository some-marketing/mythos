---
description: Inscribe lore — create a new concept, as a flat file or a bundle
argument-hint: <slug> [--bundle]
allowed-tools: [Read, Write, Edit, Glob, Grep]
---

> Authority: `concept-init` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Inscribe lore: create a new concept file or concept bundle under `_dev/concepts/`. A concept is a durable record of a decision and its reasoning. The policy is flat by default, and a bundle when the work needs accumulated context or cross-model dispatch alongside the concept.
</objective>

<process>
1. Parse arguments for a concept slug (required, kebab-case) and the optional `--bundle` flag.
2. **Flat (default):** create `_dev/concepts/<slug>.md` with standard frontmatter (title, identified date, context) and sections for Problem, Decision, Rationale, and Next Steps.
3. **Bundle (`--bundle`):** create `_dev/concepts/<slug>/concept.md` with the same frontmatter, a `status.json` (slug, created date, author, stage `draft`, empty dispatches, null promoted_to), and empty `context/` and `dispatch/` directories.
4. Never overwrite an existing concept without confirmation.
5. Report what was created and the next step.
</process>

<success_criteria>
- Concept file or bundle created at the correct path
- If a bundle: status.json, context/, and dispatch/ directories exist
- No existing concept overwritten without confirmation
</success_criteria>

<handoff>
concept_created_flat: accumulate context, or promote it to a bundle when cross-model work begins
concept_created_bundle: dispatch the concept to a distinct model for review, or plan it via /plan-quest
</handoff>
