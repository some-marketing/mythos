#!/usr/bin/env python3
"""
Audio worker for the voice channel plugin.

Runs as a subprocess of the TypeScript MCP server.
Communicates via line-delimited JSON over stdin/stdout.

Inbound (from TypeScript):
  {"type": "speak", "text": "Hello world"}

Outbound (to TypeScript):
  {"type": "transcription", "text": "what time is it"}
  {"type": "status", "state": "LISTENING", "is_speaking": false}
  {"type": "ready"}
  {"type": "error", "message": "..."}
"""

import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path

# Resolve the voice tools directory (parent of plugin/)
VOICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(VOICE_DIR))

# Load .env from voice tools directory
from dotenv import load_dotenv
load_dotenv(VOICE_DIR / ".env")

import numpy as np
import sounddevice as sd

# Audio config
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
BLOCKSIZE = 1024

# VAD config
VAD_ENERGY_THRESHOLD = int(os.environ.get("VAD_ENERGY_THRESHOLD", "800"))
VAD_SILENCE_DURATION = float(os.environ.get("VAD_SILENCE_DURATION", "2.5"))
VAD_MIN_RECORDING_DURATION = float(os.environ.get("VAD_MIN_RECORDING_DURATION", "0.5"))

# Whisper config
WHISPER_MODEL = str(VOICE_DIR / "models" / "ggml-base.en.bin")
WHISPER_CLI = "/opt/homebrew/bin/whisper-cli"

# State
IDLE = "IDLE"
RECORDING = "RECORDING"
PROCESSING = "PROCESSING"

vad_state = IDLE
audio_chunks = []
speech_start_time = 0.0
last_speech_time = 0.0
is_speaking = False
_voice_ready = threading.Event()
_write_lock = threading.Lock()


def emit(msg: dict):
    """Send a JSON message to the TypeScript server via stdout."""
    with _write_lock:
        line = json.dumps(msg) + "\n"
        sys.stdout.write(line)
        sys.stdout.flush()


def log(msg: str):
    """Log to stderr (doesn't interfere with IPC)."""
    sys.stderr.write(f"audio_worker: {msg}\n")
    sys.stderr.flush()


# ── Transcription ────────────────────────────────────────────────────────

import re

def clean_transcription(text: str) -> str:
    """Strip noise annotations, return empty string if pure noise."""
    if not text or len(text.strip()) < 2:
        return ""
    cleaned = re.sub(r'\([^)]*\)', '', text).strip()
    cleaned = re.sub(r'\[[^\]]*\]', '', cleaned).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = cleaned.strip('- .,;')
    if not cleaned or len(cleaned) < 2:
        return ""
    noise_only = {"sonidos", "tararea", "ruido", "background", "music",
                  "clicking", "humming", "inaudible", "unintelligible",
                  "unclear", "silence", "noise"}
    words = set(cleaned.lower().split())
    if words and words.issubset(noise_only):
        return ""
    return cleaned


async def transcribe(wav_bytes: bytes) -> str:
    """Transcribe audio using local whisper-cpp."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(wav_bytes)
        tmp_path = tmp.name
    try:
        proc = await asyncio.create_subprocess_exec(
            WHISPER_CLI, "-m", WHISPER_MODEL, "-f", tmp_path,
            "--no-timestamps", "--no-prints", "-t", "4",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        return stdout.decode("utf-8", errors="replace").strip()
    finally:
        os.unlink(tmp_path)


def chunks_to_wav_bytes(chunks: list) -> bytes:
    """Convert audio chunks to WAV bytes."""
    import io, wave
    if not chunks:
        return b""
    audio_data = np.concatenate(chunks, axis=0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data.tobytes())
    return buf.getvalue()


# ── VAD ──────────────────────────────────────────────────────────────────

def audio_callback(indata, frames, time_info, status):
    """Called by sounddevice for every audio block."""
    global vad_state, speech_start_time, last_speech_time
    if is_speaking:
        return

    rms = np.sqrt(np.mean(indata.astype(np.float64) ** 2))

    if vad_state == IDLE:
        if rms > VAD_ENERGY_THRESHOLD:
            vad_state = RECORDING
            speech_start_time = time.monotonic()
            last_speech_time = time.monotonic()
            audio_chunks.clear()
            audio_chunks.append(indata.copy())
            log("recording started")

    elif vad_state == RECORDING:
        audio_chunks.append(indata.copy())
        if rms > VAD_ENERGY_THRESHOLD:
            last_speech_time = time.monotonic()
        else:
            silence = time.monotonic() - last_speech_time
            duration = time.monotonic() - speech_start_time
            if silence >= VAD_SILENCE_DURATION and duration >= VAD_MIN_RECORDING_DURATION:
                vad_state = PROCESSING
                _voice_ready.set()


# ── Voice Processor ─────────────────────────────────────────────────────

def voice_processor():
    """Background thread: waits for VAD trigger, transcribes, emits to TypeScript."""
    global vad_state

    loop = asyncio.new_event_loop()

    while True:
        _voice_ready.wait()
        _voice_ready.clear()

        wav_bytes = chunks_to_wav_bytes(list(audio_chunks))
        audio_chunks.clear()

        if len(wav_bytes) < 1000:
            vad_state = IDLE
            continue

        log("transcribing...")
        try:
            raw_text = loop.run_until_complete(transcribe(wav_bytes))
        except Exception as e:
            log(f"STT error: {e}")
            emit({"type": "error", "message": f"STT error: {e}"})
            vad_state = IDLE
            continue

        text = clean_transcription(raw_text)
        if not text:
            if raw_text:
                log(f"noise rejected: {raw_text}")
            else:
                log("no speech detected")
            vad_state = IDLE
            continue

        log(f"heard: {text}")
        emit({"type": "transcription", "text": text})
        vad_state = IDLE


# ── TTS (import from voice_chat) ─────────────────────────────────────────

_speak_func = None

def _get_speak_func():
    global _speak_func
    if _speak_func is None:
        from voice_chat import speak_text
        _speak_func = speak_text
    return _speak_func


async def handle_speak(text: str):
    """Speak text via choir TTS."""
    global is_speaking
    is_speaking = True
    try:
        speak_func = _get_speak_func()
        # Redirect stdout during TTS — voice_chat.py uses print()
        real_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            await speak_func(text)
        finally:
            sys.stdout = real_stdout
        log(f"spoke: {text[:50]}...")
    except Exception as e:
        log(f"TTS error: {e}")
        emit({"type": "error", "message": f"TTS error: {e}"})
    finally:
        is_speaking = False


# ── Stdin Command Handler ────────────────────────────────────────────────

def stdin_reader():
    """Read commands from TypeScript server via stdin."""
    loop = asyncio.new_event_loop()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            log(f"invalid JSON: {line}")
            continue

        if cmd.get("type") == "speak":
            text = cmd.get("text", "")
            if text:
                loop.run_until_complete(handle_speak(text))
                emit({"type": "spoke", "text": text[:50]})
        elif cmd.get("type") == "status":
            emit({
                "type": "status",
                "state": vad_state,
                "is_speaking": is_speaking,
            })
        elif cmd.get("type") == "quit":
            log("quit received")
            break


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    log("starting audio worker...")

    # Start mic
    input_stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype=DTYPE,
        callback=audio_callback,
        blocksize=BLOCKSIZE,
    )
    input_stream.start()
    log(f"mic active (threshold={VAD_ENERGY_THRESHOLD}, silence={VAD_SILENCE_DURATION}s)")

    # Start voice processor thread
    processor = threading.Thread(target=voice_processor, daemon=True)
    processor.start()

    # Signal ready
    emit({"type": "ready"})
    log("ready")

    # Read commands from TypeScript on main thread
    try:
        stdin_reader()
    except KeyboardInterrupt:
        pass
    finally:
        input_stream.stop()
        input_stream.close()
        log("shutdown")


if __name__ == "__main__":
    main()
