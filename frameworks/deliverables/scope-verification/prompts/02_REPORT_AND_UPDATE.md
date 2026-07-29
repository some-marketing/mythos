# 02 — Report and Update

## Purpose
Present verified discrepancies to the user, collect approval for corrections, generate corrected passages, and apply approved corrections to the scope document.

## Execution Mode
PATCH_ALLOWED — may modify the scope document with explicit user confirmation for each correction.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `SCOPE_DOCUMENT` | Yes | Path to the original scope document |
| `DISCREPANCY_REPORT.md` | Yes | Output from Prompt 01 at `verification_output/DISCREPANCY_REPORT.md` |
| `verification_summary.json` | Yes | Output from Prompt 01 at `verification_output/verification_summary.json` |
| `comparison_matrix.json` | Yes | Output from Prompt 01 at `verification_output/comparison_matrix.json` |

## Process

### Step 1: Present Discrepancy Summary [USER]
1. Read `verification_output/verification_summary.json`
2. Present to user:
   - Overall verdict
   - Count of discrepancies by severity (CRITICAL, MAJOR, MINOR)
   - Brief description of each CRITICAL and MAJOR discrepancy
3. Ask user: "Which discrepancies would you like to correct in the scope document? You may specify by number, severity level, or 'all'."
4. **STOP and wait for user response before proceeding.**

### Step 2: Generate Corrected Passages [AUTO]
For each user-approved discrepancy:
1. Read the original passage from the scope document at the cited line number
2. Read the verified source data from `comparison_matrix.json`
3. Generate a corrected passage that:
   - Replaces the incorrect count with the verified count
   - Adds any missing items
   - Removes any phantom items
   - Preserves the original document style and formatting
4. Record the correction:
   ```
   Location: [file:line]
   Original: "[exact original text]"
   Corrected: "[exact corrected text]"
   Reason: [discrepancy ID and description]
   ```

### Step 3: Present Corrections for Confirmation [USER]
1. Present each generated correction to the user:
   - Show the original text
   - Show the proposed corrected text
   - Show the evidence supporting the correction
2. Ask user to confirm, modify, or reject each correction
3. **STOP and wait for user response before proceeding.**

### Step 4: Apply Approved Corrections [AUTO]
1. For each confirmed correction:
   - Read the scope document
   - Locate the exact original text
   - Replace with the confirmed corrected text
   - Verify the replacement was applied correctly
2. After all corrections applied:
   - Re-read the modified scope document
   - Verify each correction is present
   - Check that no unintended changes were made
3. Report completion:
   - Number of corrections applied
   - Number of corrections rejected
   - Suggest re-running Prompt 01 to verify the updated scope

## Output
- Modified scope document (in place)
- Summary of applied corrections reported in chat

## Success Criteria
- User explicitly approved every correction before application
- Only approved corrections were applied to the scope document
- Original text accurately replaced (no partial replacements or formatting damage)
- No corrections applied without user confirmation
- Corrected values match verified source data exactly
- No new approximations introduced by corrections

## Failure Modes
| Condition | Action |
|-----------|--------|
| User declines all corrections | Report "No corrections applied" and exit cleanly |
| Original text cannot be found at cited line | WARN; show surrounding context and ask user to identify correct location |
| Scope document is read-only or locked | STOP; report permission error |
| Correction would change document structure | WARN; present structural impact to user before applying |
| Multiple passages match the original text | STOP; present all matches and ask user to select the correct one |
| verification_summary.json does not exist | STOP; inform user to run Prompt 01 first |
| DISCREPANCY_REPORT.md does not exist | STOP; inform user to run Prompt 01 first |
