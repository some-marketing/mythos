# 01 — Communication Architecture

## Purpose

Map the communication landscape before fetching feedback. Identify who speaks where, what types of feedback exist, and how the handoff chain works between stakeholders and developers. This architecture drives all subsequent provenance tracking and authority assignment.

## Execution Mode

**FINDINGS_ONLY** — Observe, gather context, and produce the communication architecture document. No feedback is fetched or interpreted in this step.

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `source_tool` | string | Yes | PM tool containing feedback: `dart` or `notion` |
| `source_location` | string | Yes | Board name, page URL, or database ID in the source tool |
| `stakeholder_map` | JSON | No | Mapping of stakeholder names to roles and communication notes |
| `scope_document` | path | No | Path to scope document for scope-boundary checking |
| `task_prefix` | string | No | Prefix for task IDs (e.g., `CLIENTB` for CLIENTB-001) |
| `destination_format` | string | Yes | Output format: `markdown`, `json`, or `github-issues` |

## Process

### Step 1: Collect Source Context [USER]

Gather the following from the user:

1. **Source tool** — Which PM tool holds the feedback? (Dart or Notion)
2. **Source location** — What board, page, or database should be read?
3. **Stakeholder context** — Who are the key people providing feedback? What are their roles?
4. **Scope boundaries** — Is there a scope document? What is in/out of scope?
5. **Task ID prefix** — What prefix should generated task IDs use?
6. **Output format** — How should the final task list be delivered?

**STOP and wait for user response before proceeding.**

### Step 2: Build Communication Architecture [AUTO]

From the collected context, map the communication landscape:

- **Channels**: Where does feedback live? (Dart comments, Notion page blocks, Notion database properties)
- **Feedback types**: What kinds of feedback exist? (approval, revision request, bug report, feature request, question, general comment)
- **Flow direction**: How does feedback flow? (stakeholder -> PM tool -> this framework -> developer)
- **Handoff chain**: Who hands off to whom? At what points does feedback change hands?

### Step 3: Map Stakeholder Roles [AUTO]

For each identified stakeholder, assign an authority level:

| Authority Level | Role | Description |
|----------------|------|-------------|
| 1 | Decision-maker | Directs what gets done. Their feedback becomes highest-priority tasks. |
| 2 | Reviewer | Identifies issues and approves work. Medium-priority tasks. |
| 3 | Observer | Provides input but does not direct work. Lowest-priority tasks. |

If a `stakeholder_map` was provided, use it as the primary source. Otherwise, infer roles from context and flag for user confirmation.

### Step 4: Write Communication Architecture [AUTO]

Write `task_output/communication_architecture.json` with the following structure:

```json
{
  "source_tool": "dart|notion",
  "source_location": "board/page/database identifier",
  "task_prefix": "PREFIX",
  "destination_format": "markdown|json|github-issues",
  "channels": [
    {
      "name": "channel name",
      "tool": "dart|notion",
      "location": "specific location within tool",
      "feedback_types": ["approval", "revision", "bug", "feature", "question", "comment"]
    }
  ],
  "stakeholders": [
    {
      "name": "Stakeholder Name",
      "authority_level": 1,
      "role": "decision-maker|reviewer|observer",
      "communication_notes": "Any relevant notes about how this person communicates"
    }
  ],
  "handoff_chain": [
    "Stakeholder provides feedback in source tool",
    "Framework fetches and records raw feedback",
    "Framework audits provenance and flags ambiguity",
    "Framework compiles task list with citations",
    "Developer receives task list for implementation"
  ],
  "scope_document": "path/to/scope/document or null",
  "scope_boundaries": {
    "in_scope": ["description of in-scope items"],
    "out_of_scope": ["description of out-of-scope items"]
  }
}
```

## Output

- `task_output/communication_architecture.json` — Complete communication architecture mapping

## Success Criteria

- All identified stakeholders have assigned authority levels
- Communication channels are mapped with feedback types
- Handoff chain is documented end-to-end
- Scope boundaries are recorded (or flagged as missing)
- Output is valid JSON

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| User does not provide stakeholder context | Cannot assign authority levels | Flag all stakeholders as "authority_level: unconfirmed" and proceed |
| No scope document available | Cannot check scope boundaries | Proceed without scope checking; flag in output |
| Source tool not recognized | Cannot plan fetch strategy | Ask user to confirm tool and provide connection details |
| Ambiguous stakeholder roles | Incorrect priority assignment | Present role assignments for user confirmation before writing |
