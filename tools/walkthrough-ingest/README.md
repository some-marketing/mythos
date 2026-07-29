# Walkthrough Ingest

Turns a screen recording of a manual workflow into a numbered procedure and
a Playwright automation skeleton — REVIEW_ONLY, it never executes the
procedure it produces.

## Pipeline

1. Resolve the video path (a literal path, a shell glob, or the special
   argument `latest`, which picks the most recently modified `.mov`/`.mp4`
   in `~/Documents/Screenshots`).
2. Stage it somewhere readable (macOS's Documents folder is TCC-protected;
   if a direct read fails, it copies the file to `/tmp` via `find -exec cp`
   first).
3. Probe duration/resolution with `ffprobe`, then extract frames at a
   configurable fps with `ffmpeg` (kept for inspection/fallback — the actual
   analysis is native video, not frame-by-frame).
4. Hand the whole video to `gemini -p` with a fixed prompt asking for: what's
   happening, a numbered procedure with approximate timestamps, the
   inputs/outputs it can see, and a Playwright automation skeleton.
5. Write both a Markdown artifact and a `WalkthroughIngest/1.0` JSON summary
   to the output directory (default `_dev/reports/analysis/`).

## Requirements

- `ffmpeg` / `ffprobe` on PATH.
- The `gemini` CLI on PATH, authenticated with your own API key.

## Usage

```bash
node tools/walkthrough-ingest/ingest.js latest
node tools/walkthrough-ingest/ingest.js path/to/recording.mov --out _dev/reports/analysis --slug my-workflow --fps 2
```

Ported close to verbatim — the source was already generic (no client data,
no operator-specific paths beyond the standard macOS Screenshots folder).
