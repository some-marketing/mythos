# 05: Self-Eval and Render

## Objective
Inspect the rendered output at every cut boundary using `timeline_view`. Catch visual jumps, audio pops, hidden subtitles, or overlay misalignment before showing the operator. Cap at 3 self-eval passes. On pass, produce `final.mp4`.

## Mode
REVIEW_ONLY

## Inputs
- `<edit_dir>/preview.mp4` from Prompt 04
- `<edit_dir>/edl.json` from Prompt 04
- `runner/timeline_view.py` helper

## Steps

### Phase 1: Cut-boundary inspection

1. [AUTO] For every cut boundary in edl.json, run `timeline_view` on the **rendered output** (not the sources) in a ±1.5s window around the cut:

```bash
python runner/timeline_view.py <edit_dir>/preview.mp4 <cut_time - 1.5> <cut_time + 1.5>
```

2. [AUTO] Inspect each generated image for:
   - **Visual discontinuity**: Flash, jump, or jarring transition at the cut point
   - **Waveform spike**: Audio pop at the boundary that slipped past the 30ms fade (Rule 3)
   - **Subtitle hidden**: Caption behind an overlay — Rule 1 violation
   - **Overlay misaligned**: Animation showing wrong frames — Rule 4 violation

### Phase 2: Spot checks

3. [AUTO] Sample additional frames:
   - First 2 seconds — does the video start cleanly?
   - Last 2 seconds — does it end cleanly?
   - 2–3 mid-points — grade consistency, subtitle readability, overall coherence
   - If `delivery_spec` present, spot-check text/caption clears the specified safe-zones (e.g. top 14% / bottom 20%).

4. [AUTO] Run `ffprobe` on the output:
   - Verify duration matches EDL expectation (±1%)
   - Verify frame rate matches source (or render.py `--fps` override)
   - Verify audio track present and codec correct

### Phase 3: Decision

5. [AUTO] Classify the self-eval result:
   - **PASS**: No issues found at any cut boundary or spot check. Proceed to final render.
   - **FIX**: Issues found. Document each issue with evidence (frame image, waveform, ffprobe). Return to Prompt 04 with specific fixes.
   - **CAP**: Third self-eval pass and issues remain. Flag remaining issues to operator rather than looping.

6. [AUTO] If PASS:
   - Run `python runner/render.py <edit_dir>/edl.json -o <edit_dir>/final.mp4` (full-quality, no `--preview`)
   - Produce `final.mp4` at full resolution

### Phase 4: Operator preview

7. [AUTO] Present `preview.mp4` (or `final.mp4` if self-eval passed) to the operator for review.
   - Include self-eval summary: what was checked, what passed
   - If issues were flagged (CAP case), present them explicitly

## Outputs
- Self-eval report in chat (per-cut inspection results, spot check results, ffprobe verification)
- `<edit_dir>/final.mp4` if self-eval passed
- `<edit_dir>/verify/` directory with debug frames and timeline PNGs

## Success Criteria
- [ ] Every cut boundary inspected on rendered output (±1.5s window)
- [ ] Spot checks completed (first 2s, last 2s, 2–3 mid-points)
- [ ] ffprobe duration matches EDL expectation
- [ ] Self-eval result classified (PASS / FIX / CAP)
- [ ] If PASS: final.mp4 produced
- [ ] If FIX: specific evidence-cited issues returned to Prompt 04
- [ ] If CAP: issues flagged to operator with evidence
- [ ] Self-eval pass count tracked (max 3)

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Rule 1 check: subtitles visible and not behind overlays
- Rule 3 check: no audio pops at cut boundaries (waveform inspection)
- Rule 4 check: overlay animations correctly PTS-shifted
- Self-eval cap: max 3 passes; flag to operator on 3rd failure
- Mode-specific: REVIEW_ONLY — inspect and report, do not re-render (PATCH_ALLOWED if fixes needed)
- All findings must cite specific evidence (frame image, waveform, ffprobe output)