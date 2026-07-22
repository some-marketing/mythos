# 02 — Report and Reconcile

## Purpose
Present the contradiction summary to the user, collect decisions on which items to reconcile, generate reconciled content, and apply approved changes to the designated version.

## Execution Mode
PATCH_ALLOWED — reads contradiction report and summary, interacts with user for decisions, applies approved changes to the target version.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `CONTRADICTION_REPORT.md` | Yes | Contradiction report from Prompt 01 |
| `reconciliation_summary.json` | Yes | Structured summary from Prompt 01 |
| `version_a` | Yes | Path to version A file |
| `version_b` | Yes | Path to version B file |
| `source_of_truth` | No | Which version is authoritative: 'a' or 'b' |

## Process

### Step 1: Present Contradiction Summary [USER]
1. Display a concise summary of all contradictions found:
   - Total count by severity (CRITICAL, MAJOR, MINOR, INFO)
   - List each CRITICAL finding with both values and locations
   - List each MAJOR finding briefly
2. Ask the user:
   - Which version should be updated? (A, B, or create a new merged version)
   - Should all contradictions be resolved, or only CRITICAL/MAJOR?
   - For each CRITICAL finding: which value is correct? (A's value, B's value, or a new value)
3. **STOP and wait for user response before proceeding**

### Step 2: Generate Reconciled Content [AUTO]
1. Based on user decisions from Step 1:
   - For each approved change, prepare the reconciled value
   - If source_of_truth was designated, pre-fill with authoritative values (user can override)
   - Track each change: original value, reconciled value, source of decision
2. Generate a change manifest listing all proposed modifications:
   - File to modify
   - Location within file (section/slide, line/position)
   - Current value
   - New value
   - Reason (user decision or source_of_truth)

### Step 3: Confirm Changes [USER]
1. Present the full change manifest to the user:
   - Show each proposed change in a table format
   - Highlight any changes that affect numbers, dates, or prices
2. Ask for explicit confirmation: "Apply these N changes to [target file]?"
3. **STOP and wait for user confirmation before proceeding**

### Step 4: Apply Approved Changes [AUTO]
1. Only proceed if user explicitly confirmed in Step 3
2. For each approved change:
   - Locate the exact position in the target file
   - Apply the change
   - Verify the change was applied correctly
3. Write `reconciliation_output/reconciliation_log.json`:

```json
{
  "reconciled_at": "ISO-8601",
  "target_file": "path to updated file",
  "source_of_truth": "a|b|none",
  "changes_applied": [
    {
      "location": "section/slide, line/position",
      "old_value": "...",
      "new_value": "...",
      "classification": "NUMBER_MISMATCH|TEXT_DIFFERS|...",
      "decision_source": "user|source_of_truth",
      "applied_at": "ISO-8601"
    }
  ],
  "changes_skipped": [
    {
      "location": "...",
      "reason": "..."
    }
  ],
  "summary": {
    "total_applied": 0,
    "total_skipped": 0
  }
}
```

4. Report completion:
   - Number of changes applied
   - Number of changes skipped (if any)
   - Path to updated file

## Output
- Updated target version file (only with explicit user approval)
- `reconciliation_output/reconciliation_log.json`

## Success Criteria
- User was presented all contradictions before any changes
- User explicitly chose which version to update
- User explicitly approved each CRITICAL change
- User explicitly confirmed the full change manifest
- Only approved changes were applied
- All changes logged in reconciliation_log.json
- No changes applied without explicit user confirmation

## Failure Modes
| Condition | Action |
|-----------|--------|
| CONTRADICTION_REPORT.md missing | STOP; inform user to run Prompt 01 first |
| reconciliation_summary.json missing | STOP; inform user to run Prompt 01 first |
| No contradictions found in report | Report "No contradictions to reconcile"; generate empty log |
| User declines all changes | Log "no changes applied"; generate empty reconciliation_log.json |
| Target file is read-only | STOP; inform user of permission issue |
| Cannot locate exact position for a change | WARN; skip that change, log as unapplied, continue with remaining |
| Change would corrupt file structure | STOP that individual change; inform user; continue with remaining |
| User provides ambiguous decision | Ask for clarification; do not assume |
