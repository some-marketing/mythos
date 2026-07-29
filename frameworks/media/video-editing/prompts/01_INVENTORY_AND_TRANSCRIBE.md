# 01: Inventory and Transcribe

## Objective
Inventory all source video files, verify prerequisites, run parallel transcription, and pack transcripts into the LLM's primary reading surface (`takes_packed.md`).

## Mode
FINDINGS_ONLY

## Inputs
- `videos_dir` — directory containing source video files (required)
- `ELEVENLABS_API_KEY` — environment variable or .env (required)
- `edit_dir` — custom output directory (optional, defaults to `<videos_dir>/edit/`)
- `num_speakers` — speaker count for diarization (optional)
- `language` — ISO language code (optional, auto-detected)

## Steps

1. [AUTO] Verify prerequisites:
   - `ffmpeg` and `ffprobe` on PATH → if missing, instruct operator to install and stop
   - Python >= 3.10 with required packages (requests, librosa, matplotlib, pillow, numpy) → if missing, instruct operator to `uv sync` or `pip install -e .`
   - `ELEVENLABS_API_KEY` in environment or `.env` → if missing, ask operator to provide one

2. [AUTO] Inventory sources:
   - `ffprobe` every video file in `videos_dir/` (common extensions: .mp4, .mov, .mkv, .avi, .m4v)
   - Record: filename, duration, resolution, frame rate, audio codec, audio channels
   - Note any HDR sources (HLG/PQ) that will need tone mapping (see render.py HDR handling)
   - Report source count and total runtime

3. [AUTO] Transcribe:
   - Run `python runner/transcribe_batch.py <videos_dir> --workers 4 [--num-speakers N] [--language xx]`
   - This calls ElevenLabs Scribe with word-level timestamps, speaker diarization, and audio events
   - Cached: existing transcripts are skipped unless source file changed
   - Output: `<edit_dir>/transcripts/<video_stem>.json` per source

4. [AUTO] Pack transcripts:
   - Run `python runner/pack_transcripts.py --edit-dir <edit_dir>`
   - Groups word-level entries into phrase-level lines, breaking on silence >= 0.5s or speaker change
   - Output: `<edit_dir>/takes_packed.md` — the LLM's primary reading surface

5. [AUTO] Visual first impression:
   - Run `python runner/timeline_view.py <video> <start> <end>` on 1–2 representative sources
   - Sample the opening 5s and a mid-point for visual context

## Outputs
- `<edit_dir>/takes_packed.md` — phrase-level packed transcript (primary reading artifact)
- `<edit_dir>/transcripts/<video_stem>.json` — raw Scribe JSON per source (cached)
- Inventory report in chat: source count, total runtime, notable properties (HDR, portrait, multi-speaker)

## Success Criteria
- [ ] ffmpeg, ffprobe, and Python deps confirmed
- [ ] ELEVENLABS_API_KEY resolved
- [ ] All sources inventoried (duration, resolution, frame rate, audio)
- [ ] All sources transcribed (or cache hits confirmed)
- [ ] takes_packed.md generated
- [ ] Visual first impression sampled
- [ ] No files written to framework directory

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Rule 8 (word-level verbatim ASR): transcription must use `timestamps_granularity: "word"`
- Rule 9 (cache transcripts): never re-transcribe unchanged source files
- Rule 12 (output isolation): all outputs in `<videos_dir>/edit/`
- Mode-specific: FINDINGS_ONLY — no file writes except via runner scripts to `<edit_dir>/`