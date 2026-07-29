# Runner Scripts

All Python scripts in this directory are vendored from [browser-use/video-use](https://github.com/browser-use/video-use) (MIT License, v0.1.0, commit `cf12ac35143caa48db76efa35b1cb439582333bb`).

## Attribution

- **Source**: https://github.com/browser-use/video-use
- **License**: MIT
- **Version**: 0.1.0
- **Commit**: cf12ac35143caa48db76efa35b1cb439582333bb
- **Vendored**: 2026-06-03

See `frameworks/media/video-editing/manifest.json` → `distilled_from` for full attribution metadata.

## Files

| File | Purpose |
|---|---|
| `transcribe.py` | Single-file ElevenLabs Scribe transcription (cached) |
| `transcribe_batch.py` | 4-worker parallel batch transcription |
| `pack_transcripts.py` | Scribe JSON → phrase-level `takes_packed.md` |
| `timeline_view.py` | Filmstrip + waveform PNG for visual cut inspection |
| `render.py` | EDL → per-segment extract → concat → overlays → subtitles |
| `grade.py` | Per-segment color grading (presets + custom ffmpeg filters) |

## Import Structure

All six files are siblings in this directory. Cross-file imports use bare same-directory imports:

- `transcribe_batch.py` imports from `transcribe`
- `render.py` imports from `grade`

These resolve correctly when scripts are invoked as `python runner/<name>.py` from the framework root. No `__init__.py` or package structure is needed — these are standalone scripts.
