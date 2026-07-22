# Workspace Linking

How Dart tasks connect to git workspace repos. Dart is the human collaboration frontend; git repos hold LLM-consumable technical context.

---

## The Footer Convention

Every Dart task that has a corresponding workspace context file should include a footer:

```markdown
---
**Plan:** [{filename}.md](https://github.com/{org}/{repo}/blob/main/planning/{file}.md)
**Context:** <[slug.md](https://github.com/{org}/{repo}/blob/main/projects/{project}/tasks/{file}.md)>
**Evidence:** [file.json](https://github.com/{org}/{repo}/blob/main/projects/{project}/evidence/{file})
```

- `**Plan:**` links to the `planning/` planning document that originated this task. Used by parent tasks on Mythos boards to bridge strategic truth (Layer 1) to active work (Layer 2). Optional for client workspace tasks.
- `**Context:**` links to the task's context file in the workspace repo. Required for all Implementation, Verification, and Documentation tasks. Optional for Briefs (context may not exist yet at creation time).
- `**Evidence:**` links to specific evidence files or commit URLs. Used by Verification tasks and any task with audit artifacts. Must be populated before a task can move to Done. Format: `[{short hash}]({commit URL})` for commits, `[{filename}]({blob URL})` for artifacts.
- Child tasks inherit their parent's context link unless they have their own.
- For deeper human-readable task handoffs that need an external document, extend this same footer with `**External context:**` and the `SMOS-External-Context-*` anchor fields described in `docs/EXTERNAL_CONTEXT_HANDOFFS.md`. Do not create a second footer convention.

## Context File Types

Two types of context files coexist in workspace `tasks/` directories:

### Audit Files (existing pattern)
Used for verification and validation tasks. Contain verdicts, evidence references, and claim cross-references.

```markdown
# Schema and Structured Data

| Dart ID | Title | Verdict | Evidence |
|---------|-------|---------|----------|
| rPJHiYlia0NU | Verify no AggregateRating... | VERIFIED_FIXED | evidence/round3/29_aggregate-rating.json |
```

### Brief Files (new pattern)
Used for collaborative workstreams. Contain background, technical details, and a decision log.

```markdown
# {Workstream Title}

**Dart task:** [{title}](Dart URL)
**Last updated:** {date}

## Background
[Why this workstream exists. What problem it solves.]

## Technical Details
[Too detailed for Dart: field mappings, API specs, architecture notes, code context.]

## Decisions
[Append decisions as they're made.]

### {Date} — {Decision summary}
- **Decision:** {what was decided}
- **Decided by:** {who}
- **Context:** {from Dart comments or discussion}
- **Impact:** {what changes as a result}

## Open Questions
[Move to Decisions section when resolved.]

## References
- [Relevant Dart doc or external resource]
```

## The Task Index (tasks/index.json)

Maps Dart task IDs to workspace context files, types, and verdicts.

### Schema

```json
{
  "{dart_task_id}": {
    "context_file": "{topic}.md",
    "type": "implementation",
    "verdict": "VERIFIED_FIXED",
    "status": "closable",
    "evidence": ["evidence/round1/{file}.json"],
    "dart_url": "https://app.dartai.com/t/{id}"
  }
}
```

### Fields

| Field | Required | Values |
|-------|----------|--------|
| `context_file` | yes | Filename in `tasks/` directory |
| `type` | yes | `brief`, `design_decision`, `implementation`, `verification`, `investigation`, `documentation` |
| `verdict` | no | `VERIFIED`, `VERIFIED_FIXED`, `VERIFIED_CONFIRMED`, `VERIFIED_CHANGED`, `NOT_FOUND`, `INCONCLUSIVE`, `KNOWN_STATE`, `UNVERIFIED`, `NOT_TESTABLE` |
| `status` | no | `closable`, `needs_attention`, `blocked`, `open` |
| `evidence` | no | Array of file paths relative to project root |
| `dart_url` | no | Full Dart task URL for round-trip navigation |

## CLAUDE.md Pattern for Workspace Repos

Every workspace repo should have a CLAUDE.md (or section in README.md) that explains the Dart connection:

```markdown
## Dart Integration

- **Dart Board:** {board_title}
- **Task Index:** `projects/{project}/tasks/index.json`

### Reading Tasks
1. Read `tasks/index.json` for task-to-context mapping
2. Read `tasks/*.md` for deep context per topic group
3. Evidence in `evidence/` contains raw audit/test data

### Creating Tasks
When creating Dart tasks that relate to this workspace:
1. Use the appropriate task type template (Brief, Design Decision, Implementation, etc.)
2. Add a Context footer linking to the relevant `tasks/*.md` file
3. After creation, add the task ID to `tasks/index.json`
```

## Flow

```
Human creates Brief in Dart
    ↓
Stakeholders discuss in Dart comments
    ↓
Decisions appended to git context file
    ↓
Brief becomes parent task
    ↓
Child tasks created (Implementation, Verification, etc.)
    → Each links back to parent's context file
    → Each added to index.json
    ↓
Evidence collected during execution
    → Stored in git evidence/
    → Linked from Dart task footer
    ↓
index.json updated with verdicts
```
