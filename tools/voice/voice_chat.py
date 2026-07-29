#!/usr/bin/env python3
"""
Claude Voice Chat — Always-listening voice conversation with Claude Code.

Architecture:
  VAD (energy-based) auto-detects speech → ElevenLabs STT → claude CLI (streaming) → ElevenLabs TTS → speaker

Uses your existing Claude Code auth — no Anthropic API key needed.
Only requires an ElevenLabs API key for STT + TTS.

Requirements:
  brew install portaudio
  pip install -r requirements.txt
  cp .env.example .env  # fill in ElevenLabs key

Usage:
  python voice_chat.py                          # default voice
  python voice_chat.py --pick-voice              # choose a voice first
  python voice_chat.py --session SESSION_ID      # connect to parent Claude Code session
  python voice_chat.py --bridge                   # bridge mode (file IPC with parent session)
  Just start talking. Silence auto-sends. Ctrl+C to quit.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import random
import subprocess
import sys
import tempfile
import time
import wave
from collections import deque
from pathlib import Path

import httpx
import numpy as np
import sounddevice as sd
from dotenv import load_dotenv

# ── Config ──────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")

BRIDGE_MODE = os.environ.get("VOICE_BRIDGE_MODE", "").lower() in ("true", "1", "yes") or "--bridge" in sys.argv
BRIDGE_DIR = Path(__file__).parent / "bridge"

# ── Session Log ────────────────────────────────────────────────────────────
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
_log_path = LOG_DIR / f"session_{int(time.time())}.jsonl"
_log_file = None


def vlog(event: str, **data):
    """Append a structured log entry. Readable by the main Claude session."""
    global _log_file
    if _log_file is None:
        _log_file = open(_log_path, "a")
    entry = {"ts": time.strftime("%H:%M:%S"), "event": event, **data}
    _log_file.write(json.dumps(entry) + "\n")
    _log_file.flush()


ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Rachel
CLAUDE_SYSTEM_PROMPT = (
    "YOU ARE IN VOICE MODE — speaking out loud through a microphone and speaker. "
    "ONE sentence per response. Maximum two if absolutely necessary. "
    "Do NOT use markdown, bullets, asterisks, code blocks, or any formatting. "
    "If input is garbled or unclear, say only: \"Didn't catch that, say again.\" "
    "Be warm, curious, encouraging, and direct. Like a calm friend. "
    "You are the voice interface for Mythos, an LLM operating system. "
    "The human is {OPERATOR_NAME}, the operator. He runs a marketing agency called Some Marketing. "
    "You have access to the full Mythos codebase and can help with anything. "
    "Keep it conversational — you are speaking, not writing."
)

# Voice pool — comma-separated voice IDs for chorus rotation
VOICE_POOL = [v.strip() for v in os.environ.get("VOICE_POOL", "").split(",") if v.strip()]
VOICE_CACHE_ENABLED = os.environ.get("VOICE_CACHE_ENABLED", "true").lower() == "true"
VOICE_CHORUS_OFFSET_MAX_MS = int(os.environ.get("VOICE_CHORUS_OFFSET_MS", "35"))
VOICE_SFX_ENABLED = os.environ.get("VOICE_SFX_ENABLED", "true").lower() in ("true", "1", "yes")

# Voice metadata for smart chorus mixing
VOICE_META = {
    "CwhRBWXzGAHq8TQ4Fs17": {"name": "Roger", "weight": "deep", "energy": "calm"},
    "EXAVITQu4vr4xnSDxMaL": {"name": "Sarah", "weight": "mid", "energy": "warm"},
    "FGY2WhTYpPnrIDTdsKH5": {"name": "Laura", "weight": "mid", "energy": "bright"},
    "IKne3meq5aSn9XLyUdCD": {"name": "Charlie", "weight": "deep", "energy": "bright"},
    "JBFqnCBsd6RMkjVDRZzb": {"name": "George", "weight": "deep", "energy": "warm"},
    "N2lVS1w4EtoT3dr4eOWO": {"name": "Callum", "weight": "mid", "energy": "bright"},
    "SAz9YHcvj6GT2YYXdXww": {"name": "River", "weight": "mid", "energy": "calm"},
    "SOYHLrjzK2X1ezoPC6cr": {"name": "Harry", "weight": "deep", "energy": "bright"},
    "TX3LPaxmHKxFdv7VOQHJ": {"name": "Liam", "weight": "mid", "energy": "bright"},
    "Xb7hH8MSUJpSbSDYk0k2": {"name": "Alice", "weight": "mid", "energy": "warm"},
    "XrExE9yKIg1WjnnlVkGX": {"name": "Matilda", "weight": "mid", "energy": "warm"},
    "bIHbv24MWmeRgasZH58o": {"name": "Will", "weight": "mid", "energy": "calm"},
    "cgSgspJ2msm6clMCkdW9": {"name": "Jessica", "weight": "light", "energy": "bright"},
    "cjVigY5qzO86Huf0OWal": {"name": "Eric", "weight": "mid", "energy": "warm"},
    "hpp4J3VqNfWAUOO0d1Us": {"name": "Bella", "weight": "mid", "energy": "warm"},
    "iP95p4xoKVk53GoZ742B": {"name": "Chris", "weight": "mid", "energy": "warm"},
    "nPczCjzI2devNBz1zQrb": {"name": "Brian", "weight": "deep", "energy": "warm"},
    "onwK4e9ZLuTAKqWW03F9": {"name": "Daniel", "weight": "deep", "energy": "calm"},
    "pFZP5JQG7iQjIQuC4Bku": {"name": "Lily", "weight": "light", "energy": "warm"},
    "pNInz6obpgDQGcFmaJgB": {"name": "Adam", "weight": "deep", "energy": "calm"},
    "pqHfZKP75CvOlQylNhV4": {"name": "Bill", "weight": "deep", "energy": "calm"},
    "dXtC3XhB9GtPusIpNtQx": {"name": "Hale", "weight": "mid", "energy": "bright"},
    "EkK5I93UQWFDigLMpZcX": {"name": "JM", "weight": "mid", "energy": "warm"},
    "QvlD90AkjGTCqc9685Rq": {"name": "Hyper Guy", "weight": "mid", "energy": "bright"},
    "FVQMzxJGPUBtfz1Azdoy": {"name": "Danielle", "weight": "light", "energy": "warm"},
    "1SM7GgM6IMuvQlz2BwM3": {"name": "Mark", "weight": "mid", "energy": "calm"},
    "QPBKI85w0cdXVqMSJ6WB": {"name": "Maysie", "weight": "light", "energy": "warm"},
    "UIgZ4mHZwQERxHEOfN8n": {"name": "Tyler", "weight": "mid", "energy": "bright"},
    "TgnhEILA8UwUqIMi20rp": {"name": "Jenna", "weight": "light", "energy": "warm"},
    "bAq8AI9QURijOtmeFFqT": {"name": "Sigma Centauri", "weight": "mid", "energy": "calm"},
    "QO0FqsKksQUtS020GMAJ": {"name": "Thee Toshi", "weight": "deep", "energy": "calm"},
    "MwQXU20wCONBtEfjFukj": {"name": "Adam Robot", "weight": "mid", "energy": "calm"},
    "odEwYpBavNimvcVVYzns": {"name": "August", "weight": "mid", "energy": "calm"},
}

# Track recent lead voices to avoid repetition (last 5 turns)
_recent_leads: deque = deque(maxlen=5)

# Fallback chain: pool 2+ → chorus, pool 1 → single, empty pool → ELEVENLABS_VOICE_ID
CHORUS_ENABLED = len(VOICE_POOL) >= 2

# Cache directory
CACHE_DIR = Path(__file__).parent / "cache"
_cache_count = 0

TTS_SAMPLE_RATE = 44100  # Standard WAV sample rate from ElevenLabs

SAMPLE_RATE = 16000  # 16kHz for STT
CHANNELS = 1
DTYPE = "int16"
BLOCKSIZE = 1024  # ~64ms at 16kHz

# VAD thresholds (configurable via .env)
VAD_ENERGY_THRESHOLD = int(os.environ.get("VAD_ENERGY_THRESHOLD", "500"))
VAD_SILENCE_DURATION = float(os.environ.get("VAD_SILENCE_DURATION", "1.5"))
VAD_MIN_RECORDING_DURATION = float(os.environ.get("VAD_MIN_RECORDING_DURATION", "0.5"))

# ── State ───────────────────────────────────────────────────────────────────

IDLE = "IDLE"
RECORDING = "RECORDING"
PROCESSING = "PROCESSING"

vad_state = IDLE
audio_chunks: list[np.ndarray] = []
is_speaking = False
claude_session_id = None
speech_start_time = 0.0
last_speech_time = 0.0
recording_ready_event = asyncio.Event()
_loop: asyncio.AbstractEventLoop | None = None


# ── Terminal Status ─────────────────────────────────────────────────────────

def show_status(label: str):
    """Show a single-line status indicator, overwriting the previous one."""
    # Clear the line and write the new status
    sys.stdout.write(f"\r\033[K  [{label}]  ")
    sys.stdout.flush()


# ── VAD Audio Callback ─────────────────────────────────────────────────────

def audio_callback(indata, frames, time_info, status):
    """Called by sounddevice for every audio block. Implements energy-based VAD."""
    global vad_state, speech_start_time, last_speech_time

    # Don't process audio while Claude is speaking (avoids feedback loop)
    if is_speaking:
        return

    # Calculate RMS energy of this chunk
    rms = np.sqrt(np.mean(indata.astype(np.float64) ** 2))

    if vad_state == IDLE:
        if rms > VAD_ENERGY_THRESHOLD:
            # Speech detected — transition to RECORDING
            vad_state = RECORDING
            speech_start_time = time.monotonic()
            last_speech_time = time.monotonic()
            audio_chunks.clear()
            audio_chunks.append(indata.copy())
            if _loop:
                _loop.call_soon_threadsafe(lambda: show_status("Recording..."))

    elif vad_state == RECORDING:
        audio_chunks.append(indata.copy())

        if rms > VAD_ENERGY_THRESHOLD:
            last_speech_time = time.monotonic()
        else:
            # Check if silence has lasted long enough
            silence_elapsed = time.monotonic() - last_speech_time
            recording_elapsed = time.monotonic() - speech_start_time

            if silence_elapsed >= VAD_SILENCE_DURATION and recording_elapsed >= VAD_MIN_RECORDING_DURATION:
                # Enough silence after enough speech — send it
                vad_state = PROCESSING
                if _loop:
                    _loop.call_soon_threadsafe(recording_ready_event.set)


# ── Audio Utilities ────────────────────────────────────────────────────────

def chunks_to_wav_bytes(chunks: list[np.ndarray]) -> bytes:
    """Convert recorded numpy chunks to WAV bytes for STT API."""
    if not chunks:
        return b""
    audio_data = np.concatenate(chunks, axis=0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data.tobytes())
    return buf.getvalue()


def _clean_transcription(text: str) -> str:
    """Strip noise annotations from transcription and check if real speech remains.

    Scribe adds annotations like "(typing sound)" or "(clicks tongue)" to the end
    of real speech. Strip those but keep the actual words.

    Returns cleaned text, or empty string if it was pure noise.
    """
    import re

    if not text or len(text.strip()) < 2:
        return ""

    # Strip parenthetical noise annotations: (typing sound), (clicks tongue), etc.
    cleaned = re.sub(r'\([^)]*\)', '', text).strip()
    # Strip bracket annotations: [background noise], etc.
    cleaned = re.sub(r'\[[^\]]*\]', '', cleaned).strip()
    # Strip music notation
    cleaned = cleaned.replace('\u266a', '').replace('\U0001f3b5', '').strip()

    # Clean up leftover punctuation/whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = cleaned.strip('- .,;')

    if not cleaned or len(cleaned) < 2:
        return ""

    # Check if what remains is just noise words (no real speech)
    noise_only = {"sonidos", "tararea", "ruido", "background", "music",
                  "clicking", "humming", "inaudible", "unintelligible",
                  "unclear", "silence", "noise"}
    words = set(cleaned.lower().split())
    if words and words.issubset(noise_only):
        return ""

    return cleaned


# ── ElevenLabs STT ──────────────────────────────────────────────────────────

async def transcribe(wav_bytes: bytes) -> str:
    """Send recorded audio to ElevenLabs STT and return transcription."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            files={"file": ("recording.wav", wav_bytes, "audio/wav")},
            data={"model_id": "scribe_v1", "language_code": "en"},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json().get("text", "").strip()


# ── Claude Code CLI (streaming) ─────────────────────────────────────────────

async def ask_claude_streaming(user_text: str, text_queue: asyncio.Queue):
    """Send user text to Claude Code CLI, stream text chunks to TTS queue.

    Uses `claude -p --output-format stream-json` with your existing auth.
    Maintains conversation via --resume for multi-turn context.
    """
    global claude_session_id

    cmd = [
        "claude",
        "-p", user_text,
        "--output-format", "stream-json",
        "--verbose",
        "--append-system-prompt", CLAUDE_SYSTEM_PROMPT,
    ]

    # Resume the voice session for multi-turn continuity
    if claude_session_id:
        cmd.extend(["--resume", claude_session_id])

    # Anchor cwd + identity env so Claude's per-project memory key resolves
    # to the canonical Mythos pocket and the SessionStart boot guard recognizes
    # this as an identity-class Sam launch (not ordinary dev). Without the env,
    # the guard would auto-promote (since cwd is canonical) and emit a banner;
    # with it, the guard exits silently.
    env = os.environ.copy()
    env["MYTHOS_IDENTITY_ID"] = "sam"
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(Path(__file__).resolve().parents[2]),
        env=env,
    )

    full_response = ""

    async for line in process.stdout:
        line = line.decode("utf-8").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        etype = event.get("type", "")

        # Capture session ID from init or result
        if etype == "system" and event.get("session_id"):
            claude_session_id = event["session_id"]
        elif etype == "result" and event.get("session_id"):
            claude_session_id = event["session_id"]

        # Extract text deltas from stream_event -> content_block_delta
        if etype == "stream_event":
            inner = event.get("event", {})
            if inner.get("type") == "content_block_delta":
                delta = inner.get("delta", {})
                if delta.get("type") == "text_delta":
                    text = delta.get("text", "")
                    if text:
                        full_response += text
                        await text_queue.put(text)
                        sys.stdout.write(text)
                        sys.stdout.flush()

        # Fallback: if no streaming deltas were captured, use result text
        if etype == "result" and not full_response:
            result_text = event.get("result", "")
            if result_text:
                full_response = result_text
                await text_queue.put(result_text)
                sys.stdout.write(result_text)
                sys.stdout.flush()

    await text_queue.put(None)  # Signal end of stream
    await process.wait()

    return full_response


# ── Bridge Mode (file-based IPC) ──────────────────────────────────────────

async def bridge_send_and_wait(user_text: str, timeout: float = 60.0) -> str:
    """Write transcription to inbox, wait for response in outbox."""
    BRIDGE_DIR.mkdir(exist_ok=True)
    inbox = BRIDGE_DIR / "inbox"
    outbox = BRIDGE_DIR / "outbox"

    # Clear any stale outbox
    if outbox.exists():
        outbox.unlink()

    # Write transcription to inbox
    inbox.write_text(user_text)

    # Wait for response in outbox
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if outbox.exists():
            response = outbox.read_text().strip()
            if response:
                outbox.unlink()  # consumed
                return response
        await asyncio.sleep(0.2)

    return "(no response received)"


# ── SFX Generation ─────────────────────────────────────────────────────────

def generate_startup_chime(sample_rate: int = TTS_SAMPLE_RATE) -> np.ndarray:
    """Generate a synthetic startup chime: sine sweep 800Hz -> 1200Hz over 200ms."""
    duration = 0.2
    num_samples = int(sample_rate * duration)
    freq = np.linspace(800, 1200, num_samples)
    # Cumulative phase integration for frequency sweep
    phase = 2 * np.pi * np.cumsum(freq) / sample_rate
    envelope = np.hanning(num_samples)
    chime = (np.sin(phase) * 0.2 * envelope * 32767).astype(np.int16)
    return chime


def generate_confirmation_tone(sample_rate: int = TTS_SAMPLE_RATE) -> np.ndarray:
    """Generate a subtle confirmation tone: descending 1000Hz -> 600Hz over 100ms."""
    duration = 0.1
    num_samples = int(sample_rate * duration)
    freq = np.linspace(1000, 600, num_samples)
    phase = 2 * np.pi * np.cumsum(freq) / sample_rate
    envelope = np.hanning(num_samples)
    tone = (np.sin(phase) * 0.2 * envelope * 32767).astype(np.int16)
    return tone


def generate_choir_pad(duration_seconds: float, sample_rate: int = TTS_SAMPLE_RATE) -> np.ndarray:
    """Generate a warm ambient choir pad — a soft chord that sits underneath the voices.

    Creates a major chord with slight detuning and slow amplitude modulation
    for an ethereal, cathedral-choir feel.
    """
    n = int(sample_rate * duration_seconds)
    t = np.arange(n, dtype=np.float64) / sample_rate

    # Warm major chord with octave doubling (C3-E3-G3-C4 region)
    freqs = [130.81, 164.81, 196.00, 261.63]  # C3, E3, G3, C4

    pad = np.zeros(n, dtype=np.float64)
    for f in freqs:
        # Each note slightly detuned for warmth
        detune = random.uniform(-0.5, 0.5)
        # Pure sine + soft overtone for body
        pad += np.sin(2 * np.pi * (f + detune) * t) * 0.25
        pad += np.sin(2 * np.pi * (f + detune) * 2 * t) * 0.08  # octave overtone

    # Slow amplitude modulation — breathing, alive
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.3 * t)  # gentle pulse at 0.3Hz
    pad *= lfo

    # Fade in/out for smoothness
    fade_len = int(sample_rate * 0.3)  # 300ms fades
    if fade_len > 0 and n > fade_len * 2:
        fade_in = np.linspace(0, 1, fade_len)
        fade_out = np.linspace(1, 0, fade_len)
        pad[:fade_len] *= fade_in
        pad[-fade_len:] *= fade_out

    # Very quiet — this is ambient texture, not the voice
    pad *= 0.06 * 32767
    return pad.astype(np.int16)


def audio_bytes_to_numpy(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode audio bytes (mp3 or WAV) into numpy int16 mono array + sample rate.

    Uses ffmpeg for mp3 decoding, native wave module for WAV.
    """
    # Try WAV first (starts with RIFF)
    if audio_bytes[:4] == b'RIFF':
        return _decode_wav(audio_bytes)
    # Otherwise, decode via ffmpeg (handles mp3, ogg, etc.)
    return _decode_with_ffmpeg(audio_bytes)


def _decode_wav(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode WAV bytes into numpy int16 mono."""
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
    if sampwidth == 2:
        audio = np.frombuffer(frames, dtype=np.int16)
    elif sampwidth == 1:
        audio = (np.frombuffer(frames, dtype=np.uint8).astype(np.int16) - 128) * 256
    elif sampwidth == 4:
        audio = (np.frombuffer(frames, dtype=np.int32) >> 16).astype(np.int16)
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")
    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1).astype(np.int16)
    return audio, sr


def _decode_with_ffmpeg(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode any audio format to int16 mono 44100Hz via ffmpeg."""
    proc = subprocess.run(
        [
            "ffmpeg", "-i", "pipe:0",
            "-f", "s16le", "-acodec", "pcm_s16le",
            "-ar", "44100", "-ac", "1",
            "pipe:1",
        ],
        input=audio_bytes,
        capture_output=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode()[:200]}")
    audio = np.frombuffer(proc.stdout, dtype=np.int16)
    return audio, 44100


def numpy_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Encode a numpy int16 array as WAV bytes."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio.astype(np.int16).tobytes())
    return buf.getvalue()


# ── ElevenLabs TTS (REST + afplay) ──────────────────────────────────────────

async def _fetch_tts_audio(client: httpx.AsyncClient, voice_id: str, text: str) -> bytes:
    """Fetch TTS audio from ElevenLabs for a single voice (returns mp3 or WAV)."""
    resp = await client.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.content


async def speak_text(full_text: str):
    """Send text to ElevenLabs TTS and play via afplay.

    Chorus mode (when VOICE_POOL has 2+ voices):
      - Fetches voices in parallel (mp3 or WAV, decoded to numpy)
      - Mixes them with configurable ratio and chorus offset
      - Layers startup chime at beginning and confirmation tone at end
      - Falls back to single voice on any decode/fetch error

    Single voice mode:
      - Fetches one voice, decodes, adds SFX, plays as WAV
    """
    global is_speaking
    if not full_text.strip():
        return

    is_speaking = True
    show_status("Speaking...")
    try:
        if CHORUS_ENABLED:
            # Pool has 2+ voices — chorus mode with random rotation
            await _speak_chorus(full_text)
        elif VOICE_POOL:
            # Pool has exactly 1 voice — single voice + SFX
            await _speak_single(full_text, voice_id=VOICE_POOL[0])
        else:
            # No pool — fallback to ELEVENLABS_VOICE_ID (original behavior)
            await _speak_single(full_text, voice_id=ELEVENLABS_VOICE_ID)
    except Exception as e:
        print(f"\n[TTS error: {e}]")
    finally:
        is_speaking = False


async def _speak_single(text: str, voice_id: str | None = None):
    """Single-voice TTS path."""
    # Resolve voice: explicit arg > pool first entry > ELEVENLABS_VOICE_ID
    vid = voice_id or (VOICE_POOL[0] if VOICE_POOL else ELEVENLABS_VOICE_ID)
    async with httpx.AsyncClient() as client:
        raw_bytes = await _fetch_tts_audio(client, vid, text)

    audio, sr = audio_bytes_to_numpy(raw_bytes)

    # Add SFX if enabled
    if VOICE_SFX_ENABLED:
        chime = generate_startup_chime(sr)
        tone = generate_confirmation_tone(sr)
        silence_gap = np.zeros(int(sr * 0.05), dtype=np.int16)  # 50ms gap
        audio = np.concatenate([chime, silence_gap, audio, silence_gap, tone])

    final_wav = numpy_to_wav_bytes(audio, sr)
    _save_to_cache(text, final_wav)
    await _play_wav(final_wav)


def _pick_chorus_voices() -> list[str]:
    """Pick voices for this turn — no lead, no preference, pure random draw.

    Every voice is equal. The cast shifts completely every turn.
    """
    pool = VOICE_POOL[:]

    # Fetch 4-6 real voices, chorus DSP multiplies them into many
    pick_count = random.choices([4, 5, 6], weights=[30, 40, 30])[0]
    pick_count = min(pick_count, len(pool))

    return random.sample(pool, pick_count)


async def _mix_choir_ffmpeg(audio_arrays: list[np.ndarray], sr: int) -> str:
    """Mix voices using ffmpeg filter chain for professional choir effect.

    Production chain:
      1. Center voice — clean, compressed, full presence (carries intelligibility)
      2. Side layers — panned L/R, EQ'd to cut 2-5kHz presence, chorused
      3. Shared reverb via aecho (all layers sound like one space)
      4. Bus compression (breathes as one entity)
      5. Slow aphaser modulation (shifting "hive mind" feel)

    Returns the path to the output stereo WAV file (caller handles playback + cleanup).
    Falls back to simple numpy average if ffmpeg fails.
    """
    # Shuffle so different voices land in center vs sides each turn
    random.shuffle(audio_arrays)
    n = len(audio_arrays)

    # Write each voice to a temp WAV file
    tmp_dir = tempfile.mkdtemp(prefix="choir_")
    input_files = []
    for i, arr in enumerate(audio_arrays):
        path = os.path.join(tmp_dir, f"voice_{i}.wav")
        wav_bytes = numpy_to_wav_bytes(arr, sr)
        with open(path, "wb") as f:
            f.write(wav_bytes)
        input_files.append(path)

    output_path = os.path.join(tmp_dir, "mixed.wav")

    # Build ffmpeg input args
    inputs = []
    for path in input_files:
        inputs.extend(["-i", path])

    # ── Build the filter graph ──
    # Voice 0 = center (clean, full presence, slight compression)
    # Voices 1+ = side layers (panned L/R, presence EQ cut, chorus, lower volume)
    filters = []
    mix_inputs = []

    # Center voice: light compression for consistency, full presence, moderate volume
    filters.append(
        "[0:a]acompressor=threshold=0.3:ratio=2:attack=5:release=50,"
        "volume=0.5"
        "[center]"
    )
    mix_inputs.append("[center]")

    # Side voices: spread evenly L/R with increasing pan distance
    pan_positions = []
    if n > 1:
        for i in range(1, n):
            side = -1 if i % 2 == 1 else 1
            spread = min(0.8, 0.15 * ((i + 1) // 2))  # 0.15, 0.15, 0.30, 0.30, ...
            pan_positions.append(side * spread)

    for i in range(1, n):
        pan = pan_positions[i - 1]
        # stereotools balance: -1.0=full left, 0=center, 1.0=full right
        # Volume per side voice scales down with count so mix stays clean
        side_vol = 0.35 / max(n - 1, 1)

        # Chain per side voice:
        #   highpass 120Hz (remove rumble)
        #   -> EQ cut at 3kHz (reduce presence so center carries intelligibility)
        #   -> chorus effect (subtle doubler for ensemble shimmer)
        #   -> compression (match dynamics to center)
        #   -> volume scale
        #   -> stereo pan via stereotools
        filters.append(
            f"[{i}:a]"
            f"highpass=f=120,"
            f"equalizer=f=3000:t=q:w=1.5:g=-4,"
            f"chorus=0.5:0.9:50|60:0.4|0.32:0.25|0.4:2|2.3,"
            f"acompressor=threshold=0.3:ratio=2:attack=5:release=50,"
            f"volume={side_vol:.3f},"
            f"stereotools=balance_out={pan:.2f}"
            f"[side{i}]"
        )
        mix_inputs.append(f"[side{i}]")

    # Combine all streams
    mix_count = len(mix_inputs)
    mix_labels = "".join(mix_inputs)
    filters.append(f"{mix_labels}amix=inputs={mix_count}:duration=longest:normalize=0[premix]")

    # Bus processing chain (applied to the full mix):
    #   aecho — shared reverb approximation (all voices in one space)
    #   acompressor — bus compression so the choir breathes as one
    #   aphaser — very slow modulation for shifting "hive mind" feel
    #   volume — make-up gain after compression
    #   alimiter — safety limiter to prevent clipping
    filters.append(
        "[premix]"
        "aecho=0.8:0.7:40|60:0.15|0.1,"
        "acompressor=threshold=0.4:ratio=3:attack=10:release=100,"
        "aphaser=type=t:speed=0.15:decay=0.2,"
        "volume=1.5,"
        "alimiter=limit=0.95"
        "[out]"
    )

    filter_str = ";".join(filters)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-map", "[out]",
        "-ar", str(sr),
        "-ac", "2",  # stereo — afplay handles it, laptop speakers have L/R separation
        "-f", "wav",
        output_path,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

    if proc.returncode != 0:
        # ffmpeg failed — fall back to simple numpy average
        err = stderr.decode()[:300] if stderr else "unknown"
        print(f"\n[ffmpeg mix failed: {err}]")
        max_len = max(len(a) for a in audio_arrays)
        mixed_float = np.zeros(max_len, dtype=np.float64)
        for arr in audio_arrays:
            padded = _pad_float(arr.astype(np.float64) / len(audio_arrays), max_len)
            mixed_float += padded
        fallback = np.clip(mixed_float, -32767, 32767).astype(np.int16)
        fallback_path = os.path.join(tmp_dir, "fallback.wav")
        wav_out = numpy_to_wav_bytes(fallback, sr)
        with open(fallback_path, "wb") as f:
            f.write(wav_out)
        # Clean up input files
        for path in input_files:
            try:
                os.unlink(path)
            except OSError:
                pass
        return fallback_path

    # Clean up input temp files (keep output for caller)
    for path in input_files:
        try:
            os.unlink(path)
        except OSError:
            pass

    return output_path


async def _speak_chorus(text: str):
    """Chorus-mode TTS: dynamic voice count, mix ratios, and offset per turn."""
    # Pick voices with smart mixing
    picked = _pick_chorus_voices()

    # Show the shifting cast
    names = [VOICE_META.get(v, {}).get("name", "?") for v in picked]
    show_status(f"Speaking... [{', '.join(names[:4])}{'...' if len(names) > 4 else ''}]")

    # Fetch voices in batches of 6 to avoid rate limits
    async with httpx.AsyncClient() as client:
        results = []
        for batch_start in range(0, len(picked), 6):
            batch = picked[batch_start:batch_start + 6]
            batch_results = await asyncio.gather(
                *[_fetch_tts_audio(client, vid, text) for vid in batch],
                return_exceptions=True,
            )
            results.extend(batch_results)
            if batch_start + 6 < len(picked):
                await asyncio.sleep(0.3)  # brief pause between batches

    # Collect successfully fetched audio
    audio_arrays: list[np.ndarray] = []
    sr: int | None = None
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"\n[Voice {picked[i][:8]}... fetch failed: {result}]")
            continue
        try:
            audio, sample_rate = audio_bytes_to_numpy(result)
        except Exception as e:
            print(f"\n[Voice {picked[i][:8]}... decode failed: {e}]")
            continue
        # Resample to match first successful voice's sample rate
        if sr is None:
            sr = sample_rate
        elif sample_rate != sr:
            ratio = sr / sample_rate
            indices = np.round(np.arange(0, len(audio), 1.0 / ratio)).astype(int)
            indices = indices[indices < len(audio)]
            audio = audio[indices]
        audio_arrays.append(audio)

    if not audio_arrays:
        # All fetches failed — fall back to single voice
        print("\n[All chorus voices failed, falling back to single]")
        await _speak_single(text)
        return

    if len(audio_arrays) == 1:
        mixed = audio_arrays[0]
        # Single voice — add choir pad if SFX enabled, then play as WAV
        if VOICE_SFX_ENABLED:
            voice_duration = len(mixed) / sr
            pad = generate_choir_pad(voice_duration + 0.6, sr)
            pre_pad = pad[:int(sr * 0.3)]
            voice_section = pad[int(sr * 0.3):int(sr * 0.3) + len(mixed)]
            post_pad = pad[int(sr * 0.3) + len(mixed):]
            if len(voice_section) >= len(mixed):
                voice_with_pad = mixed.astype(np.float64) + voice_section[:len(mixed)].astype(np.float64)
            else:
                voice_with_pad = mixed.astype(np.float64)
                voice_with_pad[:len(voice_section)] += voice_section.astype(np.float64)
            mixed = np.clip(voice_with_pad, -32767, 32767).astype(np.int16)
            mixed = np.concatenate([pre_pad, mixed, post_pad])
        final_wav = numpy_to_wav_bytes(mixed, sr)
        _save_to_cache(text, final_wav)
        await _play_wav(final_wav)
    else:
        # Professional choir mix via ffmpeg filter chain
        output_path = await _mix_choir_ffmpeg(audio_arrays, sr)
        tmp_dir = os.path.dirname(output_path)
        # Cache the mixed WAV
        with open(output_path, "rb") as f:
            wav_bytes = f.read()
        _save_to_cache(text, wav_bytes)
        # Play directly from the file
        try:
            proc = await asyncio.create_subprocess_exec(
                "afplay", output_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
        finally:
            try:
                os.unlink(output_path)
                os.rmdir(tmp_dir)
            except OSError:
                pass


def _pad_float(arr: np.ndarray, length: int) -> np.ndarray:
    """Pad a float64 array with zeros to the given length."""
    if len(arr) >= length:
        return arr
    return np.concatenate([arr, np.zeros(length - len(arr), dtype=np.float64)])


def _save_to_cache(text: str, wav_bytes: bytes):
    """Save mixed WAV to cache directory if caching is enabled."""
    global _cache_count
    if not VOICE_CACHE_ENABLED:
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        timestamp = int(time.time())
        cache_path = CACHE_DIR / f"{timestamp}_{text_hash}.wav"
        cache_path.write_bytes(wav_bytes)
        _cache_count += 1
        if _cache_count % 5 == 0:
            total = len(list(CACHE_DIR.glob("*.wav")))
            print(f"\n[Cache: {total} files in {CACHE_DIR}]")
    except Exception as e:
        print(f"\n[Cache write error: {e}]")


async def _play_wav(wav_bytes: bytes):
    """Write WAV bytes to a temp file and play with afplay."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(wav_bytes)
    tmp.close()
    try:
        proc = await asyncio.create_subprocess_exec(
            "afplay", tmp.name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    finally:
        os.unlink(tmp.name)


# ── Voice Picker ────────────────────────────────────────────────────────────

def list_voices() -> list[dict]:
    """Fetch all voices from ElevenLabs and display them."""
    resp = httpx.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": ELEVENLABS_API_KEY},
        timeout=15.0,
    )
    resp.raise_for_status()
    voices = resp.json().get("voices", [])

    # Group: cloned first, then premade
    cloned = [v for v in voices if v.get("category") == "cloned"]
    premade = [v for v in voices if v.get("category") == "premade"]
    other = [v for v in voices if v.get("category") not in ("premade", "cloned")]
    ordered = cloned + premade + other

    print(f"\n{'#':<4} {'Name':<25} {'Category':<12} {'Gender':<8} {'Accent':<15}")
    print("-" * 70)
    for i, v in enumerate(ordered, 1):
        labels = v.get("labels", {})
        print(
            f"{i:<4} {v.get('name', '?'):<25} {v.get('category', ''):<12} "
            f"{labels.get('gender', ''):<8} {labels.get('accent', ''):<15}"
        )

    return ordered


def preview_voice(voice_id: str, name: str):
    """Generate and play a short voice sample."""
    print(f"  Generating preview for {name}...", end="", flush=True)
    resp = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": f"Hi, I'm {name}. This is what I'll sound like as your AI assistant.",
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30.0,
    )
    resp.raise_for_status()

    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.write(resp.content)
    tmp.close()
    try:
        print(" playing...")
        subprocess.run(["afplay", tmp.name], check=True, timeout=15)
    except Exception as e:
        print(f" error: {e}")
    finally:
        os.unlink(tmp.name)


def save_voice(voice_id: str, name: str):
    """Save selected voice ID to .env."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        lines = env_path.read_text().splitlines()
    else:
        lines = []

    found = False
    for i, line in enumerate(lines):
        if line.startswith("ELEVENLABS_VOICE_ID=") or line.startswith("# ELEVENLABS_VOICE_ID="):
            lines[i] = f"ELEVENLABS_VOICE_ID={voice_id}  # {name}"
            found = True
            break
    if not found:
        lines.append(f"ELEVENLABS_VOICE_ID={voice_id}  # {name}")

    env_path.write_text("\n".join(lines) + "\n")
    print(f"\nSaved: {name} ({voice_id})")


def pick_voice_interactive():
    """Interactive voice picker with preview."""
    voices = list_voices()
    if not voices:
        print("No voices found.")
        return

    current = os.environ.get("ELEVENLABS_VOICE_ID", "")
    if current:
        match = next((v for v in voices if v["voice_id"] == current), None)
        if match:
            print(f"\nCurrent: {match['name']}")

    print("\nEnter a number to preview, then confirm or keep browsing.")
    print("Type 'q' to skip and use current voice.\n")

    while True:
        try:
            choice = input("Voice #: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if choice.lower() == "q":
            break

        try:
            idx = int(choice) - 1
            if 0 <= idx < len(voices):
                v = voices[idx]
                preview_voice(v["voice_id"], v["name"])
                confirm = input(f"  Use {v['name']}? (y/n): ").strip().lower()
                if confirm == "y":
                    save_voice(v["voice_id"], v["name"])
                    # Update in-memory
                    global ELEVENLABS_VOICE_ID
                    ELEVENLABS_VOICE_ID = v["voice_id"]
                    break
            else:
                print(f"  Pick 1-{len(voices)}")
        except ValueError:
            print("  Enter a number")


# ── Main Loop ──────────────────────────────────────────────────────────────

async def process_recording():
    """Process a completed recording: STT -> Claude CLI -> TTS."""
    global vad_state

    wav_bytes = chunks_to_wav_bytes(audio_chunks)
    audio_chunks.clear()

    if len(wav_bytes) < 1000:
        vlog("skip", reason="too_short", bytes=len(wav_bytes))
        print("\r\033[K(too short, skipped)")
        vad_state = IDLE
        show_status("Listening...")
        return

    show_status("Transcribing...")
    try:
        user_text = await transcribe(wav_bytes)
    except Exception as e:
        vlog("stt_error", error=str(e))
        print(f"\r\033[K[STT error: {e}]")
        vad_state = IDLE
        show_status("Listening...")
        return

    if not user_text:
        vlog("skip", reason="no_speech")
        print("\r\033[K(no speech detected)")
        vad_state = IDLE
        show_status("Listening...")
        return

    # Clean noise annotations from transcription, reject if nothing remains
    cleaned = _clean_transcription(user_text)
    if not cleaned:
        vlog("rejected", text=user_text)
        print(f"\r\033[K(noise rejected: \"{user_text}\")")
        vad_state = IDLE
        show_status("Listening...")
        return

    # Show original if different from cleaned
    if cleaned != user_text:
        vlog("cleaned", original=user_text, cleaned=cleaned)
    user_text = cleaned

    vlog("user", text=user_text)
    print(f"\r\033[K  You: {user_text}")
    show_status("Thinking...")
    sys.stdout.write("\n  Claude: ")
    sys.stdout.flush()

    if BRIDGE_MODE:
        # Bridge: send to parent session via file, wait for response
        show_status("Waiting for response...")
        full_response = await bridge_send_and_wait(user_text)
        sys.stdout.write(full_response)
        sys.stdout.flush()
        print()
        if full_response and full_response != "(no response received)":
            await speak_text(full_response)
    else:
        # Standalone: use claude CLI directly
        text_queue = asyncio.Queue()
        full_response = await ask_claude_streaming(user_text, text_queue)
        print()
        vlog("claude", text=full_response, length=len(full_response))
        if full_response:
            await speak_text(full_response)
            vlog("spoke", voices=len(VOICE_POOL))

    # Return to listening
    vad_state = IDLE
    show_status("Listening...")


async def main():
    global _loop
    _loop = asyncio.get_event_loop()

    if not ELEVENLABS_API_KEY:
        print("ERROR: Set ELEVENLABS_API_KEY in tools/voice/.env")
        sys.exit(1)

    # Check claude CLI is available
    try:
        result = subprocess.run(
            ["which", "claude"], capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            print("ERROR: claude CLI not found. Install Claude Code first.")
            sys.exit(1)
    except Exception:
        print("ERROR: Could not check for claude CLI.")
        sys.exit(1)

    # Voice app runs its own session (not tied to any parent)
    # It starts fresh and builds multi-turn context via --resume on its own session ID

    # Voice picker if requested
    if "--pick-voice" in sys.argv:
        pick_voice_interactive()

    print("=" * 60)
    print("  Claude Voice Chat (always-listening)")
    if CHORUS_ENABLED:
        print(f"  Multiplicity mode: {len(VOICE_POOL)} voices in pool, 5-8 per turn")
        pool_preview = ", ".join(
            VOICE_META.get(v, {}).get("name", v[:8] + "...") for v in VOICE_POOL[:4]
        )
        if len(VOICE_POOL) > 4:
            pool_preview += f" +{len(VOICE_POOL) - 4} more"
        print(f"  Pool: [{pool_preview}]")
        print(f"  Max offset: {VOICE_CHORUS_OFFSET_MAX_MS}ms  |  SFX: {VOICE_SFX_ENABLED}  |  Cache: {VOICE_CACHE_ENABLED}")
    elif VOICE_POOL:
        print(f"  Single voice: {VOICE_POOL[0][:8]}...")
        print(f"  SFX: {VOICE_SFX_ENABLED}  |  Cache: {VOICE_CACHE_ENABLED}")
    else:
        print(f"  Voice: {ELEVENLABS_VOICE_ID} (fallback)")
        print(f"  SFX: {VOICE_SFX_ENABLED}")
    print(f"  VAD threshold: {VAD_ENERGY_THRESHOLD}  |  Silence: {VAD_SILENCE_DURATION}s")
    if claude_session_id:
        print(f"  Session: {claude_session_id[:12]}... (connected)")
    else:
        print("  Session: standalone (new)")
    if BRIDGE_MODE:
        print(f"  Mode: BRIDGE (file IPC via {BRIDGE_DIR})")
    else:
        print("  Mode: standalone")
    print("  Just start talking. Ctrl+C to quit.")
    print("=" * 60)
    print()

    input_stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype=DTYPE,
        callback=audio_callback,
        blocksize=BLOCKSIZE,
    )
    input_stream.start()

    show_status("Listening...")

    try:
        while True:
            recording_ready_event.clear()
            await recording_ready_event.wait()
            await process_recording()
    except KeyboardInterrupt:
        print("\n\nGoodbye!")
    finally:
        input_stream.stop()
        input_stream.close()


if __name__ == "__main__":
    asyncio.run(main())
