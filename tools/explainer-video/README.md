# explainer-video

Proof-of-concept pipeline that turns a beat-based spec JSON into a narrated,
captioned, animated explainer MP4 — using only **PIL + ffmpeg + macOS `say`**
(no Remotion, no npm, no cloud TTS).

## How it works

Narration-driven timing keeps audio and video aligned by construction:

1. **Narration first.** For each beat, `say -v <voice>` renders the narration to
   AIFF, converts to WAV, and `ffprobe` measures its real duration. Clips are
   concatenated with 0.3 s silence gaps into `out/narration.wav`. Each beat's
   on-screen duration = its measured narration length + gap — the real total
   sets the timeline.
2. **Frames.** PIL renders 30 fps frames for each beat's measured duration. Every
   beat is a `render_bN(p)` function taking progress `p` in `[0,1]`, so elements
   animate: tokens interpolate position, elements fade via alpha, and in beat
   `b4-layers-gate` the amber gate **snaps shut** (two posts close over ~0.4 s)
   as one token is flipped up to the next tier while the other slides through
   unchanged.
3. **Captions.** Each beat's `caption` is burned in as a lower-third with a
   semi-opaque bar (drawn straight into the frames — no subtitle filter needed).
4. **Assemble.** `ffmpeg` muxes the `frame-%05d.png` sequence with the narration
   track into H.264 / yuv420p, `+faststart`, `-shortest`.

Frames + intermediate audio are deleted after assembly; a mid-beat sample frame
and a duration manifest are kept for verification.

## Run

```bash
# prove fonts + all beat renderers before the full render
python3 generate.py --spec example-spec.json --test-frame

# full build
python3 generate.py --spec example-spec.json --voice Samantha

# keep frames/audio for debugging
python3 generate.py --spec example-spec.json --keep-frames
```

`example-spec.json` is a self-contained, five-beat demo exercising every
renderer this pipeline ships with (`b1-title` through `b5-close`) — a generic
"one token clears a gate, one doesn't" walkthrough with neutral narration.
Copy it as the starting point for your own spec.

Requirements (all local): `/opt/homebrew/bin/{ffmpeg,ffprobe}`, `/usr/bin/say`,
Python 3 with Pillow. Font: `/System/Library/Fonts/Supplemental/Arial.ttf`.
(macOS-only, due to `say` and the Homebrew paths — adjust `FFMPEG`/`FFPROBE`/
`SAY` at the top of `generate.py` for other platforms.)

## Spec shape

Top level: `video_id`, `fps`, `beats[]`. Each beat needs `id` (one of the
renderer ids registered in `RENDERERS` — currently `b1-title`, `b2-orient`,
`b3-cascade-grade`, `b4-layers-gate`, `b5-close`), `narration`, and `caption`.
To add a new beat visual, write a `render_<id>(p)` function and register it in
`RENDERERS`.

## View

```bash
open out/<video_id>.mp4
```

## Output

- `out/<video_id>.mp4` — the deliverable (1920×1080, H.264 + AAC).
- `out/sample-b4.png` — representative frame from the layers+gate beat.
- `out/duration-manifest.json` — per-beat measured durations and frame counts.
