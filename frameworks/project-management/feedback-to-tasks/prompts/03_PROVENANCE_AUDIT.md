# 03 — Provenance Audit

## Purpose

Trace the provenance of every feedback item: who said it, when, in response to what, and with what authority. Build the provenance chain that will back every derived task. Flag any items with broken or incomplete provenance.

## Execution Mode

**FINDINGS_ONLY** — Analyze and document provenance. Do not create tasks or modify raw feedback.

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `raw_feedback.json` | artifact | Yes | Output from prompt 02 with all fetched feedback items |
| `communication_architecture.json` | artifact | Yes | Output from prompt 01 with stakeholder roles and authority levels |

## Process

### Step 1: Load Source Artifacts [AUTO]

Read both input artifacts:
- `task_output/raw_feedback.json` — The raw feedback items to audit
- `task_output/communication_architecture.json` — Stakeholder authority mappings

Cross-reference the stakeholder list from the architecture with the authors found in raw feedback. Identify any authors not present in the stakeholder map.

### Step 2: Trace Provenance for Each Item [AUTO]

For every feedback item in `raw_feedback.json`, build a provenance record:

| Field | Description |
|-------|-------------|
| `item_id` | ID from raw feedback |
| `author` | Who said it |
| `authority_level` | From stakeholder map: 1 (decision-maker), 2 (reviewer), 3 (observer), or `unconfirmed` |
| `timestamp` | When it was said |
| `context` | What it was in response to (parent item, thread) |
| `provenance_chain` | Full chain: author -> tool -> location -> parent -> item |
| `provenance_status` | `complete`, `partial`, or `broken` |
| `provenance_gaps` | List of missing elements in the chain (if any) |

### Step 3: Apply Provenance Checks [AUTO]

For each item, verify:

1. **Author identified** — Is the author known and mapped to an authority level?
2. **Timestamp present** — Does the item have a creation timestamp?
3. **Context traceable** — Can we trace what this feedback responds to?
4. **Source linkable** — Is there a URL or ID that links back to the original item?
5. **Content intact** — Is the verbatim content present and non-empty?

Mark provenance as:
- `complete` — All five checks pass
- `partial` — 3-4 checks pass; note which are missing
- `broken` — Fewer than 3 checks pass; item cannot be reliably traced

### Step 4: Flag Broken Provenance Chains [AUTO]

For items with `partial` or `broken` provenance:
- Record exactly what is missing
- Record whether the gap can be resolved (e.g., author might be identifiable from context)
- Do NOT attempt to fill in gaps — report them as-is

### Step 5: Write Provenance Audit [AUTO]

Write `task_output/provenance_audit.json` with the following structure:

```json
{
  "audit_metadata": {
    "audit_timestamp": "ISO 8601 timestamp",
    "total_items_audited": 0,
    "complete_provenance": 0,
    "partial_provenance": 0,
    "broken_provenance": 0,
    "unmapped_authors": []
  },
  "items": [
    {
      "item_id": "unique-id",
      "author": "Author Name",
      "authority_level": 1,
      "timestamp": "2024-01-15T10:30:00Z",
      "context": "Reply to task DART-123: 'Homepage redesign'",
      "provenance_chain": "Jane Smith -> Dart -> Project Board -> DART-123 -> comment-456",
      "provenance_status": "complete|partial|broken",
      "provenance_gaps": [],
      "original_content": "Verbatim feedback text"
    }
  ]
}
```

## Output

- `task_output/provenance_audit.json` — Provenance record for every feedback item

## Success Criteria

- Every item from raw_feedback.json has a provenance record
- Authority levels assigned from stakeholder map (or flagged as unconfirmed)
- Broken provenance chains explicitly flagged with gap details
- No provenance gaps silently filled or assumed
- Unmapped authors listed in audit metadata
- Output is valid JSON

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Author not in stakeholder map | Authority level unknown | Set to `unconfirmed`; list in `unmapped_authors` |
| Missing timestamps | Cannot order feedback chronologically | Flag as provenance gap; use parent item timestamp if available |
| Orphaned comments | Context chain broken | Mark as `broken` provenance; record parent_item as missing |
| Duplicate item IDs | Audit integrity compromised | Deduplicate by ID; keep first occurrence; flag duplicates |
| Empty content field | Nothing to derive tasks from | Flag as broken; item cannot produce valid tasks |
