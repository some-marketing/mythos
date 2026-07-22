# 02 — Source Fetch

## Purpose

Connect to the source PM tool (Dart or Notion) via MCP and fetch all feedback items with full metadata. Record everything verbatim without interpretation. This is a pure data collection step.

## Execution Mode

**RUN_ONLY** — Fetch and record. Do not interpret, categorize, or derive tasks from the fetched data.

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `communication_architecture.json` | artifact | Yes | Output from prompt 01 with source tool config |
| `source_tool` | string | Yes | PM tool: `dart` or `notion` (from architecture) |
| `source_location` | string | Yes | Board name, page URL, or database ID (from architecture) |

## Process

### Step 1: Connect to Source Tool [AUTO]

Load the communication architecture from `task_output/communication_architecture.json`.

Connect to the source tool via MCP:
- **Dart**: Use Dart MCP tools (`list_tasks`, `list_comments`, `get_dartboard`, etc.)
- **Notion**: Use Notion MCP tools (`notion-search`, `notion-fetch`, `notion-get-comments`, etc.)

Verify connectivity before proceeding. If connection fails, report the error and stop.

### Step 2: Fetch All Feedback Items [AUTO]

Retrieve all feedback from the source location:

**For Dart:**
- List all tasks on the specified dartboard
- For each task, fetch all comments via `list_comments`
- Capture task descriptions, status, assignees, and metadata
- Handle pagination — fetch ALL pages, do not stop at the first page

**For Notion:**
- Fetch the specified page or database
- Retrieve all comments via `notion-get-comments`
- For databases, query all entries and their properties
- For pages, fetch all block content including nested blocks
- Handle pagination for large datasets

### Step 3: Record Metadata for Each Item [AUTO]

For every feedback item, record the following fields:

| Field | Description |
|-------|-------------|
| `item_id` | Unique identifier from source tool (task ID, comment ID, block ID) |
| `author` | Name of the person who wrote the feedback |
| `timestamp` | When the feedback was created (ISO 8601) |
| `content` | Exact text of the feedback — verbatim, no paraphrasing |
| `parent_item` | ID of the parent task, page, or thread this feedback belongs to |
| `parent_title` | Title of the parent item for human readability |
| `thread_context` | Whether this is a top-level item or a reply, and what it replies to |
| `item_type` | Type: `task`, `comment`, `annotation`, `page_block`, `database_entry` |
| `source_url` | Direct URL to the item in the source tool (if available) |
| `raw_metadata` | Any additional metadata from the source tool (status, tags, assignee, etc.) |

### Step 4: Write Raw Feedback [AUTO]

Write `task_output/raw_feedback.json` with the following structure:

```json
{
  "fetch_metadata": {
    "source_tool": "dart|notion",
    "source_location": "location identifier",
    "fetch_timestamp": "ISO 8601 timestamp",
    "total_items_fetched": 0,
    "pagination_complete": true
  },
  "items": [
    {
      "item_id": "unique-id",
      "author": "Author Name",
      "timestamp": "2024-01-15T10:30:00Z",
      "content": "Exact verbatim text of the feedback",
      "parent_item": "parent-id",
      "parent_title": "Parent Item Title",
      "thread_context": "top-level|reply-to:item-id",
      "item_type": "task|comment|annotation|page_block|database_entry",
      "source_url": "https://...",
      "raw_metadata": {}
    }
  ]
}
```

## Output

- `task_output/raw_feedback.json` — All feedback items with full metadata, verbatim

## Success Criteria

- Source tool connected successfully via MCP
- All feedback items fetched (pagination complete)
- Every item has: item_id, author, timestamp, content, parent_item, thread_context
- Content is verbatim — no paraphrasing, no summarization, no interpretation
- Fetch metadata records total count and completion status
- Output is valid JSON

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| MCP connection fails | No data fetched | Report error with tool name and error message; stop |
| Pagination incomplete | Missing feedback items | Log warning in fetch_metadata; set `pagination_complete: false` |
| Author not identifiable | Cannot trace provenance | Record as `"author": "unknown"` and flag in metadata |
| Empty source location | No items to fetch | Write empty items array; report to user |
| Rate limiting | Partial fetch | Record fetched items; note truncation in fetch_metadata |
