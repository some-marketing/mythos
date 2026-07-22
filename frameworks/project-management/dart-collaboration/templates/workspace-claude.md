# {{Client Name}} Workspace

## What This Is

This repo holds technical context, evidence, and validation files for {{client_name}} projects, managed in Dart.

## People

- **{{Name}}** ({{role}}) — {{what they own}}
- **{{Name}}** ({{role}}) — {{what they own}}

## Dart Integration

- **Dart Board:** {{board_title}}
- **Task Index:** `projects/{{project}}/tasks/index.json`

### Reading Tasks
1. Read `tasks/index.json` for task-to-context mapping
2. Read `tasks/*.md` for deep context per topic group
3. Evidence in `evidence/` contains raw audit/test data

### Creating Tasks
When creating Dart tasks that relate to this workspace:
1. Use the appropriate task type template (Brief, Design Decision, Implementation, Verification, Investigation, Documentation)
2. Add a `**Context:**` footer linking to the relevant `tasks/*.md` file
3. After creation, add the task ID to `tasks/index.json`
4. See `Mythos/frameworks/project-management/dart-collaboration/docs/TASK_TYPES.md` for templates

## Structure

### tasks/
Markdown context files linked from Dart task footers. Two types coexist:
- **Audit files** — verdicts, evidence references, claim cross-references (for verification tasks)
- **Brief files** — background, technical details, decision log (for collaborative workstreams)

Naming: `{slug}.md` where slug matches the Dart task's context link.

### evidence/
Structured evidence from automated audits, organized by round.
- Files are JSON (machine-readable) or TXT (raw captures)
- Evidence files are immutable snapshots — don't modify, create new rounds instead

### specs/
Technical specifications and reference documents.

## Conventions

- Context files are living documents — append decisions, don't rewrite history
- Evidence files are immutable snapshots from a specific audit round
- `index.json` is the machine-readable bridge between Dart and this repo
- Never remove entries from `index.json` — tasks may be archived but history matters
