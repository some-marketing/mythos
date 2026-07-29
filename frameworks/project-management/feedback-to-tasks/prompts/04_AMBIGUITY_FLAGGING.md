# 04 — Ambiguity Flagging

## Purpose

Identify vague, contradictory, or out-of-scope feedback items. For each ambiguous item, document what is ambiguous, who said it, and what clarification is needed. This prevents the task formatting step from inferring actions that were never explicitly requested.

## Execution Mode

**FINDINGS_ONLY** — Analyze and flag. Do not create tasks, resolve ambiguities, or suggest actions beyond identifying the problem.

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `provenance_audit.json` | artifact | Yes | Output from prompt 03 with provenance-audited feedback |
| `communication_architecture.json` | artifact | Yes | Output from prompt 01 with scope boundaries |
| `scope_document` | file | No | Scope document for boundary checking |

## Process

### Step 1: Load Provenance-Audited Feedback [AUTO]

Read `task_output/provenance_audit.json` and `task_output/communication_architecture.json`.

If a scope document path was recorded in the communication architecture, read it for scope boundary checking.

### Step 2: Identify Ambiguity Categories [AUTO]

Scan every provenance-audited item for the following ambiguity types:

| Category | Description | Example |
|----------|-------------|---------|
| `vague` | Feedback lacks specificity — cannot determine what action to take | "This doesn't look right" |
| `contradictory` | Conflicts with another feedback item from same or different stakeholder | "Make it bigger" vs "Make it smaller" |
| `out_of_scope` | Refers to work outside the current project boundaries | "Can we also redesign the blog?" |
| `missing_context` | References something not available in the fetched feedback | "Like we discussed yesterday" |
| `implicit_action` | Implies an action without explicitly requesting one | "I noticed the old version was faster" |
| `multi_intent` | Single feedback item contains multiple distinct requests | "Fix the color, add search, and change the layout" |

### Step 3: Document Each Ambiguity [AUTO]

For each flagged item, record:

| Field | Description |
|-------|-------------|
| `item_id` | ID from provenance audit |
| `author` | Who said it |
| `authority_level` | From provenance audit |
| `ambiguity_type` | Category from Step 2 |
| `original_content` | Verbatim feedback text |
| `what_is_ambiguous` | Specific description of the ambiguity |
| `clarification_needed` | What question would resolve the ambiguity |
| `related_items` | IDs of contradictory or related items (if applicable) |

**Critical rule:** Never suggest what the stakeholder "probably meant." Only describe what is ambiguous and what clarification would resolve it.

### Step 4: Write Ambiguity Flags [AUTO]

Write `task_output/ambiguity_flags.json` with the following structure:

```json
{
  "flag_metadata": {
    "flag_timestamp": "ISO 8601 timestamp",
    "total_items_reviewed": 0,
    "total_flags": 0,
    "flags_by_type": {
      "vague": 0,
      "contradictory": 0,
      "out_of_scope": 0,
      "missing_context": 0,
      "implicit_action": 0,
      "multi_intent": 0
    }
  },
  "flags": [
    {
      "item_id": "unique-id",
      "author": "Author Name",
      "authority_level": 1,
      "ambiguity_type": "vague",
      "original_content": "Verbatim feedback text",
      "what_is_ambiguous": "Description of the specific ambiguity",
      "clarification_needed": "Question that would resolve this",
      "related_items": []
    }
  ]
}
```

## Output

- `task_output/ambiguity_flags.json` — All identified ambiguities with clarification questions

## Success Criteria

- Every feedback item was reviewed for all six ambiguity categories
- Flagged items have specific descriptions (not generic "this is vague")
- Clarification questions are concrete and answerable
- Contradictory items reference each other in `related_items`
- Out-of-scope items cite the scope boundary they violate
- No suggested resolutions — only questions
- Output is valid JSON

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| No scope document available | Cannot check scope boundaries | Skip `out_of_scope` checking; note in metadata |
| All items flagged as ambiguous | Task list will be mostly questions | Acceptable — better to over-flag than to infer actions |
| No ambiguities found | May indicate insufficient analysis | Review is still valid; write empty flags array |
| Contradictions between authority levels | Unclear which direction to prioritize | Flag both items; note authority levels; let user resolve |
| Multi-intent items | One source becomes multiple flags | Create one flag per distinct intent within the item |
