# Video Editing Guardrails

Framework-specific execution constraints for `media/video-editing`. Extends system guardrails at `Mythos/instructions/canonical/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: Default for inventory, pre-scan, and strategy proposal phases. Read files, analyze transcripts, propose edits. No file writes to video sources.
- **PATCH_ALLOWED**: EDL production, segment extraction, rendering, and subtitle generation. Writes to `<videos_dir>/edit/` only.
- **REVIEW_ONLY**: Self-evaluation of rendered output via `timeline_view`. Inspect only; no re-rendering in this mode unless issues found.

## Hard Production Rules (non-negotiable)

These rules encode silent failure modes that an LLM would produce when calling ffmpeg directly. They are correctness, not taste. Each rule cites its upstream source in `browser-use/video-use` SKILL.md.

### Rule 1: Subtitles applied LAST in filter chain
> Upstream Rule 1

Subtitles must be the final filter in any ffmpeg filter graph, after all overlays. Otherwise overlays hide captions — silent failure.

**Enforced by:** Prompt 05 (SELF_EVAL), guardrails checklist.

### Rule 2: Per-segment extract → lossless concat
> Upstream Rule 2

Each segment must be extracted individually with grade + fades baked in, then concatenated with `-c copy`. Never use a single-pass filtergraph — this double-encodes every segment when overlays are added.

**Enforced by:** Prompt 04 (EXECUTE_EDIT), runner/render.py pipeline order.

### Rule 3: 30ms audio fades at every segment boundary
> Upstream Rule 3

Every segment must have `afade=t=in:st=0:d=0.03,afade=t=out:st={dur-0.03}:d=0.03`. Without this, audible pops occur at every cut boundary — silent failure.

**Enforced by:** Prompt 04 (EXECUTE_EDIT), runner/render.py per-segment extraction.

### Rule 4: Overlay PTS-shift
> Upstream Rule 4

Animation overlays must use `setpts=PTS-STARTPTS+T/TB` to shift the overlay's frame 0 to its window start. Otherwise you see the middle of the animation during the overlay window.

**Enforced by:** Prompt 04 (EXECUTE_EDIT), runner/render.py overlay composition.

### Rule 5: Master SRT uses output-timeline offsets
> Upstream Rule 5

Subtitle timestamps must use `output_time = word.start - segment_start + segment_offset`. Otherwise captions misalign after segment concat — silent failure.

**Enforced by:** Prompt 04 (EXECUTE_EDIT), runner/render.py subtitle generation.

### Rule 6: Never cut inside a word
> Upstream Rule 6

Every cut edge must snap to a word boundary from the Scribe transcript. Cutting mid-word produces audible artifacts.

**Enforced by:** Prompt 04 (EXECUTE_EDIT) — EDL start/end times must fall on word boundaries from takes_packed.md.

### Rule 7: Pad every cut edge (30–200ms working window)
> Upstream Rule 7

Scribe timestamps drift 50–100ms. Padding absorbs the drift. Use 30–200ms padding on every cut edge. Tighter for fast-paced content, looser for cinematic.

**Enforced by:** Prompt 04 (EXECUTE_EDIT) — cut padding constraint.

### Rule 8: Word-level verbatim ASR only
> Upstream Rule 8

Transcription must use Scribe's word-level timestamps with `timestamps_granularity: "word"`. Never use SRT/phrase mode (loses sub-second gap data). Never use normalized fillers (loses editorial signal — "um" and "uh" are cut candidates).

**Enforced by:** Prompt 01 (INVENTORY_AND_TRANSCRIBE) — transcription parameter requirements.

### Rule 9: Cache transcripts per source
> Upstream Rule 9

Never re-transcribe a source file unless the file itself changed. `transcribe.py` checks for existing transcript JSON before calling Scribe.

**Enforced by:** runner/transcribe.py cache check, Prompt 01 documentation.

### Rule 10: Parallel sub-agents for multiple animations
> Upstream Rule 10

When multiple animation overlays are needed, spawn them in parallel. Never sequential — total wall time ≈ slowest one.

**Enforced by:** Prompt 04 (EXECUTE_EDIT) — animation sub-agent spawning instructions.

### Rule 11: Strategy confirmation before execution
> Upstream Rule 11

The operator must approve the proposed edit strategy in plain English before any cuts are executed. The [GATE] in Prompt 03 is non-negotiable.

**Enforced by:** Prompt 03 [GATE] operator confirmation, guardrails checklist.

### Rule 12: All outputs in `<videos_dir>/edit/`
> Upstream Rule 12

Never write inside the `frameworks/media/video-editing/` directory during a session. All session outputs go to `<videos_dir>/edit/`. The framework directory is read-only during execution.

**Enforced by:** All prompt output contracts, runner script path resolution.

### Hard Rule Override Policy

These 12 rules are non-negotiable by default — they encode silent failure modes that an LLM cannot detect without them. However, edge cases exist. A rule may be overridden only if **all three** conditions are met:

1. **Operator explicitly approves the override** in plain English, naming the specific rule and the specific reason.
2. **The reason cites evidence** — a specific source file, render artifact, or platform constraint that the rule doesn't account for.
3. **The override is recorded** in `<edit_dir>/project.md` with the rule number, reason, operator approval, and date.

Overrides are per-session, not permanent. A rule overridden for one project does not stay overridden for the next. The guardrails document remains authoritative.

**Never override:** Rule 11 (strategy confirmation) — the operator gate is non-negotiable. Rule 12 (output isolation) — the framework directory must remain read-only during execution.

---

## Additional Guardrails

### API Key Handling
- `ELEVENLABS_API_KEY` must be present in environment or `.env` at the video-use repo root before any transcription.
- Never hardcode an API key in framework files, prompts, or runner scripts.
- Never log or echo the API key in command output.
- `runner/transcribe.py` reads from `.env` or environment via `load_api_key()` — this behavior is preserved from upstream.

### Python Dependency Check
- Before running Prompt 01, verify Python >= 3.10 and required packages (requests, librosa, matplotlib, pillow, numpy).
- If packages are missing, instruct the operator to run `uv sync` or `pip install -e .` from the framework root.
- Do not auto-install packages without operator confirmation.

### ffmpeg/ffprobe Availability
- `ffmpeg` and `ffprobe` must be on PATH before any rendering or transcription.
- Prompt 01 must verify both binaries are available before calling any helper.
- If missing, instruct the operator to install (brew install ffmpeg, apt-get install ffmpeg, etc.) and wait.

### Output Directory Isolation
- All framework outputs go to `<videos_dir>/edit/`, never to the framework directory.
- The framework directory (`frameworks/media/video-editing/`) is read-only during execution.
- Runner scripts resolve output paths relative to the operator-provided `videos_dir` or `edit_dir`.

### Client Data Isolation
- Framework files must not contain client names, project paths, ad account IDs, or API keys.
- The framework is project-agnostic. All session-specific data lives in the operator's video source directory.

### Observational Reporting
- All findings use observational language per system guardrails.
- Self-eval findings in Prompt 05 must cite specific evidence: frame image, waveform, or ffprobe output.
- Never claim "looks good" without citing the inspection evidence.

### Self-Eval Cap
- Maximum 3 self-eval passes per render. On the 3rd failure, flag remaining issues to the operator rather than looping.
- Each self-eval pass must run `timeline_view` on the rendered output at every cut boundary (±1.5s window).
- Also sample: first 2s, last 2s, and 2–3 mid-points for grade consistency and subtitle readability.

### Transcription Caching
- Transcriptions are cached per source file in `<edit_dir>/transcripts/<video_stem>.json`.
- Never re-transcribe unless the source file timestamp or checksum changed.
- `pack_transcripts.py` reads from the cache, not from fresh Scribe calls.

---

---

## Amendment A — Gemini Flash Visual-Error Cross-Check on Extracted Frames (2026-06-23)

**Operator directive 2026-06-23.** Before any visual defect found in an extracted video frame is flagged, used to request a re-edit, or surfaced in a self-eval finding, run the Gemini Flash cross-check on the relevant frame(s).

The multimodal-watch-lane memory rule (`reference_multimodal-watch-lane-frame-verify`) establishes that ffprobe + extracted frames outrank watch reports as visual evidence. This amendment extends that principle to the defect-reporting gate: Gemini Flash is the cross-check authority for extracted-frame text and visual accuracy.

### Rule

> **Suspected visual defect in a frame → extract the frame (ffmpeg) → run `creative-text-verify` (Gemini Flash) → only flag if confirmed.
> `DISAGREE` verdict → surface both reads, do NOT assert a defect.**

### How to run

1. Extract the relevant frame:
   ```sh
   ffmpeg -ss <timestamp> -i <source_video> -frames:v 1 /tmp/frame-verify.png
   ```

2. Run the cross-check:
   ```sh
   node tools/ai-bridge/creative-text-verify.js \
     --images /tmp/frame-verify.png \
     --expect "<key=value;key=value>" \
     --claim "<specific visual defect claim>" \
     --output reports/creative-verify/<slug>-frame-verdict.json
   ```

Engine: `tools/ai-bridge/adapters/gemini-api.js` (model: `gemini-2.5-flash`).
Memory rule: `feedback_visual-error-claims-need-gemini-flash-verify`.

### Verdict outcomes

| Verdict    | Action |
|------------|--------|
| `PASS`     | Suspected defect not confirmed — do not flag. |
| `FAIL`     | Defect confirmed — flag with frame path + verdict JSON as evidence. |
| `DISAGREE` | Gemini uncertain — surface both reads with timestamps + confidence; do NOT assert; escalate to operator. |

### Philosophy / operator gates

Expanding this cross-check to automated rendering gates or self-eval loop hard-stops requires `/ground-in-philosophy` grounding + explicit operator approval. This amendment covers the review/self-eval reporting step only — Rules 11 and 12 are unchanged.

---

## Checklist

- [ ] ELEVENLABS_API_KEY confirmed before transcription
- [ ] ffmpeg and ffprobe confirmed on PATH
- [ ] Python dependencies confirmed before helper invocation
- [ ] Strategy confirmed by operator before any cuts (Rule 11)
- [ ] All 12 hard rules observed during execution
- [ ] Self-eval completed before operator preview (3-pass cap)
- [ ] No outputs written to framework directory (Rule 12)
- [ ] All findings use observational language with cited evidence
- [ ] No API keys, client data, or credentials in any framework artifact