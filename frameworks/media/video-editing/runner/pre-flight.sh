#!/usr/bin/env bash
# pre-flight.sh — verify all video-editing framework prerequisites in one pass
# Run from frameworks/media/video-editing/
set -euo pipefail

PASS=0
FAIL=0
WARN=0

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ $name (optional)"
    WARN=$((WARN + 1))
  fi
}

echo "=== System Tools ==="
check "ffmpeg" command -v ffmpeg
check "ffprobe" command -v ffprobe
check "python3 >= 3.10" python3 -c "import sys; assert sys.version_info >= (3,10)"

echo ""
echo "=== Python Packages ==="
check "requests" python3 -c "import requests"
check "numpy" python3 -c "import numpy"
check "pillow" python3 -c "import PIL"
check "matplotlib" python3 -c "import matplotlib"
warn "librosa" python3 -c "import librosa"

echo ""
echo "=== API Key ==="
if [ -n "${ELEVENLABS_API_KEY:-}" ]; then
  echo "  ✓ ELEVENLABS_API_KEY (environment)"
  PASS=$((PASS + 1))
elif [ -f .env ] && grep -q "ELEVENLABS_API_KEY" .env 2>/dev/null; then
  echo "  ✓ ELEVENLABS_API_KEY (.env file)"
  PASS=$((PASS + 1))
else
  echo "  ⚠ ELEVENLABS_API_KEY not set (set env var or create .env)"
  WARN=$((WARN + 1))
fi

echo ""
echo "=== Helper Scripts ==="
for script in transcribe.py transcribe_batch.py pack_transcripts.py timeline_view.py render.py grade.py; do
  check "runner/$script (parse OK)" python3 -c "import ast; ast.parse(open('runner/$script').read())"
done

echo ""
echo "=== Optional Tools ==="
warn "yt-dlp" command -v yt-dlp
warn "node" command -v node

echo ""
echo "---"
echo "Result: $PASS passed, $FAIL failed, $WARN warnings"
if [ $FAIL -gt 0 ]; then
  echo "Fix the failures above before running the framework."
  exit 1
elif [ $WARN -gt 0 ]; then
  echo "Warnings are optional — transcription won't work without API key; yt-dlp needed for online sources."
  exit 0
else
  echo "All checks passed."
  exit 0
fi