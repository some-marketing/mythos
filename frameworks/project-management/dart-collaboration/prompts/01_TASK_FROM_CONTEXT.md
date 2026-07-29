# 01 — Create Dart Task from Workspace Context

**Execution mode:** PATCH_ALLOWED
**MCP required:** dart

## Purpose

Read a workspace context file and create a corresponding Dart task using the appropriate task type template.

## Inputs

1. **Workspace context file path** — a `.md` file in the workspace `tasks/` directory
2. **Dart board name** — which dartboard to create the task on
3. **Task type** (optional) — if not specified, infer from the context file content

## Procedure

### Step 1: Read context file

Read the workspace context file. Identify:
- The workstream title
- Whether it requires stakeholder input (Brief) or is an atomic step (Deliverable)
- Who should be assigned
- What priority and tags apply

### Step 1b: Branch on shape — single task vs. Owner-Summary tree

Before choosing a task type, decide which **shape** the context describes:

- **Multi-person deliverable with a distinct owner audience** → emit a **3-level `tasks/` workspace tree** and DEFER Dart creation to the reusable creator. Do NOT hand-create the multi-task tree here.
- **Solo / simple / internal work** → continue with the single-task path (Steps 2–5 below).

Apply the **threshold rule**:
- **2+ contributors** (distinct people doing implementation work) → full Owner-Summary tree with one `FOR__<person>.md` grouping per contributor.
- **1 contributor + a distinct owner audience** (e.g. a client/stakeholder who should read a plain-language summary) → Owner Summary parent + implementation children; the `FOR__<person>` grouping layer is optional.
- **Solo / internal, no distinct owner** → single task (skip to Step 2).

When the Owner-Summary tree applies, follow **Step 1c** instead of Steps 2–5.

### Step 1c: Emit the Owner-Summary workspace tree (multi-person path)

Build a 3-level structure under the workspace `tasks/` directory and let the reusable creator build the Dart tree. The three levels are:

1. **Owner Summary** (parent, type `owner_summary`) — a plain-language `OWNER_SUMMARY__<owner>.md` doc written for the owner/stakeholder audience.
2. **`For <Person>` grouping** (type `for_grouping`) — one `FOR__<person>.md` per contributor; that contributor's implementation tasks nest under it.
3. **Implementation children** — one `IMPL__<person>-<slug>.md` per atomic work item, nested under the contributor's grouping.

Write these files plus a nested `index.json` describing the tree (owner_summary block, `groups[]` with each grouping and its `tasks[]`). Use the live reference at `clients/{CLIENT_CODE}/projects/homenet-replacement/tasks/` as the canonical shape.

Then **defer Dart creation** to the reusable creator rather than calling `create_task` per node:

```bash
node tools/dart-integration/create-tasks-from-workspace.js <tasks-dir> [--dry-run] [--default-board "<name>"]
```

The creator reads the `tasks/` index, creates the parent first, nests groupings and implementation children, and writes `dart_task_id` / `dart_url` back into `index.json` (idempotent). Present the planned tree (or `--dry-run` output) for confirmation before the live run. Skip Steps 2–5 — they are the single-task path only.

### Step 2: Determine task type

> Single-task path only. If Step 1b routed to the Owner-Summary tree, use Step 1c instead.

Use the decision table from `docs/TASK_TYPES.md`:

| Signal | Type |
|--------|------|
| Multiple stakeholders, will spawn subtasks | Brief |
| Visual options for review | Design Decision |
| Single person, atomic, clear done state | Implementation |
| Confirms existing work | Verification |
| Something unknown needs investigation | Investigation |
| Primary output is a document | Documentation |

### Step 3: Generate task title and description

Apply the template for the determined task type from `docs/TASK_TYPES.md`.

- **Brief:** Noun phrase title. Issue At Hand, Questions per stakeholder, Done Looks Like.
- **Design Decision:** Topic noun phrase. Issue at Hand, Proposed Designs with Notes and Questions.
- **Deliverable types:** Verb + object + context title. Summary, Questions checklist, Action Items checklist.

Include the `**Context:**` footer linking back to the workspace context file.

### Step 4: Present for confirmation

**REQUIRED:** Present the generated title, description, assignee, status, tags, and priority to the user for confirmation before calling `create_task`.

Format:
```
**Title:** {title}
**Type:** {task_type}
**Status:** {status}
**Assignee:** {name}
**Priority:** {priority}
**Tags:** {tags}

**Description:**
{full description}

Create this task? [Confirm/Edit/Cancel]
```

### Step 5: Create task and update index

After user confirmation:
1. Call `mcp__Dart__create_task` with the approved details
2. Add the new task to `tasks/index.json` with `type`, `context_file`, and `dart_url` fields
3. Report the created task URL

## Output

- Created Dart task (via MCP)
- Updated `tasks/index.json` entry
