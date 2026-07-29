# 06: Iterate and Persist

## Objective
Process operator feedback, re-plan and re-render as needed, and persist session memory to `project.md` so next week's session picks up where this one left off.

## Mode
PATCH_ALLOWED

## Inputs
- `<edit_dir>/preview.mp4` or `final.mp4` from Prompt 05
- Operator feedback (natural language)
- `<edit_dir>/project.md` (existing or new)
- `<edit_dir>/edl.json` from Prompt 04
- All cached transcripts (never re-transcribe — Rule 9)

## Steps

1. [AUTO] Collect operator feedback in natural language. The operator may request:
   - Different cut points or take choices
   - Pacing adjustments (tighter/looser)
   - Grade changes (warmer, cooler, more contrast)
   - Subtitle style changes
   - Animation additions, removals, or adjustments
   - Structural reordering

2. [AUTO] Map feedback to specific changes:
   - Cut changes → update edl.json
   - Grade changes → update per-segment grade field
   - Subtitle changes → update subtitle style in render command
   - Animation changes → update or add animation slots
   - Structural changes → re-plan beat order

3. [AUTO] Re-render with changes:
   - Return to Prompt 04 (EXECUTE_EDIT) with updated edl.json
   - Re-run Prompt 05 (SELF_EVAL) on the new output
   - Never re-transcribe — cached transcripts are authoritative (Rule 9)

4. [AUTO] When operator is satisfied:
   - Confirm final render exists as `final.mp4`
   - Run final ffprobe to record output metadata

5. [AUTO] Append to `project.md`:
   ```
   ## Session: <ISO date>
   
   - **Sources**: <count> files, <total runtime>
   - **Output**: final.mp4 (<duration>, <resolution>, <fps>)
   - **Strategy**: <1-line summary>
   - **Grade**: <preset or custom>
   - **Subtitles**: <style>
   - **Notes**: <operator notes, decisions, open questions>
   - **Next session**: <what to pick up, pending ideas>
   ```

## Outputs
- Updated `<edit_dir>/edl.json` (if changes made)
- Updated `<edit_dir>/final.mp4` (latest render)
- Updated `<edit_dir>/project.md` (session memory appended)

## Success Criteria
- [ ] Operator feedback collected and mapped to specific changes
- [ ] Re-render completed (if changes requested)
- [ ] Self-eval re-run on re-rendered output
- [ ] Operator confirms satisfaction with final.mp4
- [ ] project.md appended with session summary
- [ ] Next-session notes recorded for continuity

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Rule 9 (cache transcripts): never re-transcribe — cached transcripts are authoritative
- Rule 12 (output isolation): all changes in `<videos_dir>/edit/`
- Mode-specific: PATCH_ALLOWED — updating EDL, re-rendering, appending project.md
- project.md is session memory — append, never overwrite
- Next-session notes should include the exact pickup command