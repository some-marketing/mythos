#!/usr/bin/env bash
# notes-audio-transcribe.sh — On-device transcription of audio (call recordings, voice notes).
#
# PRIVACY CONTRACT (private-surface-introspection-rule.yaml):
#   - Runs FULLY on-device: ffmpeg (decode) + whisper.cpp (STT). No audio/transcript egress.
#   - Output transcripts are EPHEMERAL and MUST NOT be committed to the repo
#     (no-repo-commit-of-private-output). Default output dir is under $TMPDIR.
#   - Caller is responsible for redaction before surfacing third-party speech to a frontier model.
#
# Usage: notes-audio-transcribe.sh <audio-file> [<audio-file> ...]
# Env:   TRANSCRIBE_OUTDIR (override ephemeral output dir)
# Emits: one "TRANSCRIPT: <path>.txt" line per input; "OUTDIR: <dir>" footer.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${WHISPER_MODEL:-$REPO_ROOT/tools/voice/models/ggml-base.en.bin}"
OUTDIR="${TRANSCRIBE_OUTDIR:-${TMPDIR:-/tmp}/mythos-private-transcripts}"

command -v ffmpeg    >/dev/null || { echo "ERROR: ffmpeg not found" >&2; exit 1; }
command -v whisper-cli >/dev/null || { echo "ERROR: whisper-cli not found" >&2; exit 1; }
[ -f "$MODEL" ] || { echo "ERROR: model missing: $MODEL" >&2; exit 1; }
[ "$#" -ge 1 ]  || { echo "usage: $0 <audio-file> [<audio-file> ...]" >&2; exit 2; }

mkdir -p "$OUTDIR"
for f in "$@"; do
  if [ ! -f "$f" ]; then echo "SKIP (not found): $f" >&2; continue; fi
  base="$(basename "$f")"; stem="${base%.*}"
  wav="$OUTDIR/${stem}.16k.wav"; ofprefix="$OUTDIR/${stem}"
  echo "[transcribe] decode: $base" >&2
  ffmpeg -nostdin -y -i "$f" -vn -ar 16000 -ac 1 -c:a pcm_s16le "$wav" >/dev/null 2>&1
  echo "[transcribe] whisper: $base" >&2
  whisper-cli -m "$MODEL" -f "$wav" -otxt -of "$ofprefix" >/dev/null 2>&1
  rm -f "$wav"
  echo "TRANSCRIPT: ${ofprefix}.txt"
done
echo "OUTDIR: $OUTDIR (ephemeral — do not commit)"
