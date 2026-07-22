# 04: Execute Edit

## Objective
Produce the edit decision list (EDL), spawn animation sub-agents in parallel, apply color grade per segment, and compose the rendered output. This is where cuts actually happen.

## Mode
PATCH_ALLOWED

## Inputs
- `<edit_dir>/takes_packed.md` from Prompt 01
- Operator-confirmed strategy from Prompt 03
- `runner/` helpers: `render.py`, `grade.py`, `timeline_view.py`

## Steps

### Phase 1: Editor sub-agent brief (for multi-take selection)

1. [AUTO] When the task involves "pick the best take of each beat across many clips," spawn a dedicated sub-agent (or reason inline for simpler edits) with the following brief structure:

```
You are editing a <type> video. Pick the best take of each beat and
assemble them chronologically by beat, not by source clip order.

INPUTS:
  - takes_packed.md (time-annotated phrase-level transcripts)
  - Editorial direction: <summary from Prompt 03>
  - Structural archetype: <from strategy>
  - Target runtime: <seconds>

RULES (non-negotiable):
  - Start/end times must fall on word boundaries from the transcript (Rule 6).
  - Pad cut boundaries in working window 30–200ms (Rule 7).
  - Prefer silences >= 400ms as cut targets.
  - Unavoidable slips are kept if no better take exists. Note them in "reason".

OUTPUT (JSON array):
  [{"source": "<filename>", "start": <seconds>, "end": <seconds>,
    "beat": "<BEAT_NAME>", "quote": "...", "reason": "..."}, ...]

Return the final EDL and a one-line total runtime check.
```

### Phase 2: Produce EDL

2. [AUTO] Write `edl.json` to `<edit_dir>/edl.json`:
   - Array of segment objects: `source`, `start`, `end`, `beat`, `grade`
   - Start/end times on word boundaries from transcript (Rule 6)
   - Pad every cut edge 30–200ms (Rule 7)
   - Total runtime must match strategy estimate (±5%)

### Phase 3: Color grade

3. [AUTO] For each segment, apply grade:
   - Use preset from strategy (`warm_cinematic`, `neutral_punch`, `none`, or custom)
   - `runner/grade.py` is imported by `render.py` — invoked automatically during render
   - Per-segment extraction bakes grade into each clip (not post-concat — avoids double-encoding, Rule 2)

### Phase 4: Animations (if requested)

4. [AUTO] If strategy includes animation overlays:
   - Create `<edit_dir>/animations/slot_<id>/` per animation
   - Spawn animation sub-agents in parallel (Rule 10), not sequentially
   - Supported engines: HyperFrames (`npx --yes hyperframes`), Remotion, Manim, PIL
   - Animation engines are lazy-installed in their slot directory — never at framework root
   - Each animation overlay gets PTS-shifted during render (Rule 4)

### Phase 5: Compose

5. [AUTO] Run `python runner/render.py <edit_dir>/edl.json -o <edit_dir>/preview.mp4 --preview`:
   - Per-segment extract with grade + 30ms audio fades (Rule 3)
   - Lossless `-c copy` concat into base (Rule 2)
   - Overlays composited with PTS-shift (Rule 4)
   - Master SRT generated with output-timeline offsets (Rule 5)
   - Subtitles applied LAST in filter chain (Rule 1)
   - `--preview` flag for 720p fast render

## Outputs
- `<edit_dir>/edl.json` — cut decisions
- `<edit_dir>/master.srt` — output-timeline subtitles
- `<edit_dir>/preview.mp4` — rendered preview

## Success Criteria
- [ ] edl.json produced with word-boundary cuts and padding (Rules 6, 7)
- [ ] Runtime within 5% of strategy estimate
- [ ] Grade applied per-segment (not post-concat)
- [ ] Animations spawned in parallel if multiple (Rule 10)
- [ ] Render completes without errors
- [ ] preview.mp4 exists at expected path
- [ ] No files written to framework directory

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Rule 1 (subtitles LAST): subtitle filter must be final in the chain
- Rule 2 (extract → concat): per-segment extraction, not single-pass
- Rule 3 (30ms fades): audio fades baked at every segment boundary
- Rule 4 (PTS-shift): overlay animations PTS-shifted to window start
- Rule 5 (output-timeline offsets): SRT uses offset from concat
- Rule 6 (word-boundary cuts): every cut on a word boundary
- Rule 7 (cut padding): 30–200ms padding per edge
- Rule 10 (parallel animations): spawn N at once
- Rule 12 (output isolation): all outputs in `<videos_dir>/edit/`
- Mode-specific: PATCH_ALLOWED — writing EDL and rendered output to edit/