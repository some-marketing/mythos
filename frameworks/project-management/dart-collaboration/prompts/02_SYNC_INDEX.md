# 02 — Sync Task Index with Dart Board

**Execution mode:** PATCH_ALLOWED
**MCP required:** dart

## Purpose

Reconcile the workspace `tasks/index.json` with the current state of the Dart board. Identify tasks in Dart that aren't indexed, indexed tasks that have changed in Dart, and stale entries.

## Inputs

1. **Workspace project path** — path to the project directory containing `tasks/index.json`
2. **Dart board name** — which dartboard to sync with

## Procedure

### Step 1: Load current state

1. Read `tasks/index.json` from the workspace
2. List all tasks from the Dart board via `mcp__Dart__list_tasks`
3. Paginate if needed — fetch ALL tasks

### Step 2: Classify discrepancies

For each Dart task, check if it exists in `index.json`:

**Missing from index:** Task exists in Dart but not in `index.json`
- Determine task type from description structure
- Identify which context file it should link to (or flag as "needs context file")

**Index entry outdated:** Task exists in both but Dart status differs from index status
- Note the discrepancy (e.g., Dart says "Done" but index says "open")

**Orphaned index entry:** Entry exists in index but task is trashed/deleted in Dart
- Flag but do NOT remove — orphaned entries may be historical

### Step 3: Report discrepancies

Present findings as an observational report:

```
## Sync Report: {board_name} ↔ {project_path}

### Dart Tasks: {count}
### Indexed Tasks: {count}

### Missing from index ({count})
| Dart ID | Title | Inferred Type | Suggested Context File |
|---------|-------|---------------|----------------------|

### Status drift ({count})
| Dart ID | Title | Dart Status | Index Status | Suggested Update |
|---------|-------|-------------|--------------|-----------------|

### Orphaned entries ({count})
| Dart ID | Context File | Last Known Status |
|---------|--------------|-------------------|
```

### Step 4: Apply updates (with confirmation)

**REQUIRED:** Present all proposed index.json changes for user confirmation before writing.

For each missing task:
- Add entry with `type`, `context_file` (or "unlinked"), `dart_url`
- Set `status` based on Dart status

For each status drift:
- Update `status` field to match current Dart state

Do NOT remove orphaned entries. Flag them in the report only.

### Step 5: Write updated index

After confirmation, write the updated `tasks/index.json`.

## Output

- Sync report (observational)
- Updated `tasks/index.json` (after confirmation)
