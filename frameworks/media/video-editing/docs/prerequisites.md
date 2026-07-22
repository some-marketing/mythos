# Video Editing Framework — Prerequisites

## System Requirements

### ffmpeg and ffprobe
**Required.** Both must be on `$PATH`.

```bash
# macOS
brew install ffmpeg

# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y ffmpeg

# Arch
sudo pacman -S ffmpeg

# Verify
ffmpeg -version
ffprobe -version
```

### Python 3.10+ with dependencies
**Required.** The six runner scripts (`runner/*.py`) depend on:

| Package | Purpose |
|---|---|
| `requests` | ElevenLabs Scribe API calls |
| `librosa` | Audio loading and analysis |
| `matplotlib` | Waveform plotting in timeline_view |
| `pillow` (PIL) | Image composition in timeline_view |
| `numpy` | Audio/array processing |

Install from the framework root:

```bash
# Using uv (recommended)
cd frameworks/media/video-editing
uv pip install requests librosa matplotlib pillow numpy

# Using pip
pip install requests librosa matplotlib pillow numpy
```

### Optional: yt-dlp
For downloading videos from YouTube and other online sources:

```bash
brew install yt-dlp    # macOS
pip install yt-dlp     # cross-platform
```

### Optional: Animation engines
Lazy-installed the first time a project needs them. Never pre-installed at the framework level.

- **HyperFrames**: Requires Node.js 22+. Install in the animation slot: `npx --yes hyperframes ...`
- **Remotion**: Install in the animation slot: `npx create-video@latest` or project-local. Authoring rules and the lazy project-local pattern: `docs/animation-overlay-remotion.md`.
- **Manim**: Install in the animation slot. See `skills/manim-video/` in upstream repo for guidance.

## API Key

### ElevenLabs Scribe
**Required.** All transcription uses ElevenLabs Scribe (`scribe_v1` model). Without a key, nothing transcribes.

Get a key at: https://elevenlabs.io/app/settings/api-keys

Set it in one of:
1. Environment variable: `export ELEVENLABS_API_KEY="your-key"`
2. `.env` file at the framework root: `ELEVENLABS_API_KEY=your-key`

The `runner/transcribe.py` helper checks both sources. Never hardcode the key in framework files.

### Cost note
Scribe charges per minute of transcribed audio. A 10-minute source costs approximately $0.50 (check current ElevenLabs pricing). Transcriptions are cached per source — you only pay for new footage.

## Verification

After installing all prerequisites, verify:

```bash
# From the framework root
cd frameworks/media/video-editing

# Check Python deps
python -c "import requests, librosa, matplotlib, PIL, numpy; print('Python deps OK')"

# Check ffmpeg
ffmpeg -version > /dev/null 2>&1 && echo "ffmpeg OK" || echo "ffmpeg MISSING"

# Check ElevenLabs key (optional — only if you want to test transcription)
[ -n "$ELEVENLABS_API_KEY" ] && echo "API key set" || echo "API key NOT SET"

# Check helper scripts are invokable
python runner/transcribe.py --help > /dev/null 2>&1 && echo "transcribe.py OK"
python runner/render.py --help > /dev/null 2>&1 && echo "render.py OK"
```

## Troubleshooting

| Problem | Check |
|---|---|
| `ModuleNotFoundError: No module named 'requests'` | Run `pip install requests librosa matplotlib pillow numpy` |
| `ffmpeg: command not found` | Install ffmpeg (see above) |
| `ELEVENLABS_API_KEY not found` | Set env var or create `.env` at framework root |
| `Scribe returned 401` | API key is invalid or expired |
| `Scribe returned 429` | Rate limited — wait and retry |
| `librosa` installation fails on macOS | Try `brew install libsndfile` first, then retry |

## For Framework Authors

This framework is the first in Mythos with Python runtime dependencies. The conventions established here should be reused by future Python-dependent frameworks:

- **Prerequisite docs**: List all runtime dependencies with install commands for each OS. Python packages go in a table with purpose descriptions.
- **Guardrails check**: Include a "Python Dependency Check" section in guardrails.md enforcing that deps are verified before helper invocation and that auto-install never happens without operator confirmation.
- **Prompt-level verification**: Prompt 01 (or the first prompt that invokes a helper) must verify deps as its first [AUTO] step, with clear instructions for the operator if deps are missing.
- **Smoke test expectations**: Framework smoke tests should report which deps are available vs. missing, but treat missing deps as documented prerequisites rather than test failures.