#!/usr/bin/env python3
"""
Voice channel MCP server for Claude Code.

Listens to the microphone via VAD, transcribes speech, and delivers it
as channel notifications to the active Claude Code session. Claude responds
by calling the voice_reply tool, which speaks via the choir TTS system.

Same pattern as the iMessage channel — voice input appears inline in the
conversation, not as a separate session.
"""

# Force unbuffered stdout/stderr for pipe communication with Claude Code
import os
os.environ.setdefault("PYTHONUNBUFFERED", "1")

import asyncio
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

# Load .env from the voice tools directory (lightweight, no C extensions)
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Heavy imports (numpy, sounddevice, etc.) are deferred until after
# the MCP handshake so Claude Code doesn't time out on connect.
np = None
sd = None

def _load_heavy_imports():
    global np, sd
    import numpy as _np
    import sounddevice as _sd
    np = _np
    sd = _sd

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# Audio config
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
BLOCKSIZE = 1024

# VAD config
VAD_ENERGY_THRESHOLD = int(os.environ.get("VAD_ENERGY_THRESHOLD", "800"))
VAD_SILENCE_DURATION = float(os.environ.get("VAD_SILENCE_DURATION", "2.5"))
VAD_MIN_RECORDING_DURATION = float(os.environ.get("VAD_MIN_RECORDING_DURATION", "0.5"))

# TTS config - import choir mixing from voice_chat
VOICE_POOL = [v.strip() for v in os.environ.get("VOICE_POOL", "").split(",") if v.strip()]

# Wake/sleep phrases (case-insensitive substring match)
WAKE_PHRASE = os.environ.get("WAKE_PHRASE", "hey claude").lower()
SLEEP_PHRASE = os.environ.get("SLEEP_PHRASE", "go to sleep").lower()

# State
IDLE = "IDLE"
RECORDING = "RECORDING"
PROCESSING = "PROCESSING"

vad_state = IDLE
audio_chunks = []
speech_start_time = 0.0
last_speech_time = 0.0
is_speaking = False
_msg_counter = 0
_write_lock = threading.Lock()
_initialized = threading.Event()
# Capture the real stdout buffer at import time. write_message always uses
# this reference, so TTS code that rebinds sys.stdout cannot corrupt the
# MCP JSON-RPC stream.
_mcp_out = sys.stdout.buffer
_awake = True  # Always listening — no wake phrase needed

# ── MCP Protocol (JSON-RPC 2.0 over stdio) ────────────────────────────────

def write_message(msg: dict):
    """Write a JSON-RPC message to the MCP stream. Thread-safe via lock.

    MCP stdio transport is newline-delimited JSON (one message per line) —
    NOT LSP Content-Length framing. Claude Code cannot handshake with a
    Content-Length-framed server; that bug kept this server unattachable.
    """
    data = json.dumps(msg)
    with _write_lock:
        _mcp_out.write(data.encode())
        _mcp_out.write(b"\n")
        _mcp_out.flush()


def read_message() -> dict | None:
    """Read a JSON-RPC message from stdin.

    Primary: newline-delimited JSON (MCP stdio spec). Legacy fallback: if a
    line looks like an LSP 'Content-Length' header, honor that framing so
    old clients keep working.
    """
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None  # EOF
        stripped = line.decode(errors="replace").strip()
        if not stripped:
            continue
        if stripped.startswith("{"):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                continue
        # Legacy Content-Length framing
        headers = {}
        while stripped:
            if ":" in stripped:
                key, val = stripped.split(":", 1)
                headers[key.strip()] = val.strip()
            nxt = sys.stdin.buffer.readline()
            if not nxt:
                return None
            stripped = nxt.decode(errors="replace").strip()
        content_length = int(headers.get("Content-Length", "0"))
        if content_length == 0:
            return None
        data = sys.stdin.buffer.read(content_length)
        if not data:
            return None
        return json.loads(data.decode())


def send_notification(method: str, params: dict):
    """Send a JSON-RPC notification (no id, no response expected)."""
    write_message({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })


def send_response(req_id, result: dict):
    """Send a JSON-RPC response."""
    write_message({
        "jsonrpc": "2.0",
        "id": req_id,
        "result": result,
    })


def send_error(req_id, code: int, message: str):
    """Send a JSON-RPC error response."""
    write_message({
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    })


# ── Audio Utilities ────────────────────────────────────────────────────────

def chunks_to_wav_bytes(chunks: list) -> bytes:
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


def clean_transcription(text: str) -> str:
    """Strip noise annotations, return empty string if pure noise."""
    import re
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


# ── Local Whisper STT (whisper-cpp on Apple Silicon GPU) ──────────────────

WHISPER_MODEL = str(Path(__file__).parent / "models" / "ggml-base.en.bin")
WHISPER_CLI = "/opt/homebrew/bin/whisper-cli"

async def transcribe(wav_bytes: bytes) -> str:
    """Transcribe audio using local whisper-cpp. No API calls."""
    import asyncio, tempfile
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
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        return stdout.decode("utf-8", errors="replace").strip()
    finally:
        os.unlink(tmp_path)


# ── TTS (import choir system from voice_chat) ─────────────────────────────

# We import the speak_text function from voice_chat at runtime
# to reuse the full choir mixing + ffmpeg pipeline.
# This MUST stay lazy — voice_chat.py imports sounddevice globally
# and we need to avoid double-initializing the audio system.
_speak_func = None

def _get_speak_func():
    global _speak_func
    if _speak_func is None:
        sys.path.insert(0, str(Path(__file__).parent))
        from voice_chat import speak_text
        _speak_func = speak_text
    return _speak_func


# ── VAD Audio Callback ─────────────────────────────────────────────────────

_voice_ready = threading.Event()

def audio_callback(indata, frames, time_info, status):
    global vad_state, speech_start_time, last_speech_time
    if is_speaking:
        return
    # Don't record until MCP handshake completes — processor can't send yet
    if not _initialized.is_set():
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


# ── Logging (to stderr, since stdout is MCP) ──────────────────────────────

def log(msg: str):
    sys.stderr.write(f"voice channel: {msg}\n")
    sys.stderr.flush()


# ── Voice Processing Thread ───────────────────────────────────────────────

def voice_processor():
    """Background thread: waits for VAD trigger, transcribes, emits notification."""
    global vad_state, _msg_counter, _awake

    # Wait for MCP handshake before sending any notifications
    _initialized.wait()

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

        # ── Wake / sleep gate ──
        # Normalize: lowercase, strip punctuation edges for matching
        text_lower = text.lower().strip()
        text_stripped = text_lower.rstrip(".,!? ")

        if not _awake:
            # Dormant — wake phrase must START the utterance (not embedded)
            if text_lower.startswith(WAKE_PHRASE):
                _awake = True
                log("AWAKE — wake phrase detected")
                # Confirm via macOS TTS (instant, no API needed)
                subprocess.Popen(["say", "-r", "200", "listening"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                # Strip wake phrase from the start and forward remaining text
                # e.g. "hey claude what time is it" → "what time is it"
                remainder = text[len(WAKE_PHRASE):].strip(" ,.-")
                if remainder:
                    _msg_counter += 1
                    send_notification("notifications/claude/channel", {
                        "content": remainder,
                        "meta": {
                            "chat_id": "voice",
                            "message_id": f"voice-{_msg_counter}",
                            "user": "{OPERATOR_NAME} (voice)",
                            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        },
                    })
            else:
                log("dormant — ignored (no wake phrase)")
            vad_state = IDLE
            continue

        # Awake — sleep phrase must BE the whole utterance (not embedded)
        # "go to sleep" → triggers. "I want to go to sleep early" → does NOT.
        if text_stripped == SLEEP_PHRASE:
            _awake = False
            log("DORMANT — sleep phrase detected")
            subprocess.Popen(["say", "-r", "200", "going quiet"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            vad_state = IDLE
            continue

        # Awake and no sleep phrase — forward to Claude
        _msg_counter += 1

        # Emit channel notification
        send_notification("notifications/claude/channel", {
            "content": text,
            "meta": {
                "chat_id": "voice",
                "message_id": f"voice-{_msg_counter}",
                "user": "{OPERATOR_NAME} (voice)",
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            },
        })

        vad_state = IDLE


# ── MCP Request Handler ───────────────────────────────────────────────────

def handle_initialize(req_id, params):
    send_response(req_id, {
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {},
            "experimental": {
                "claude/channel": {},
            },
        },
        "serverInfo": {
            "name": "voice",
            "version": "1.0.0",
        },
    })


def handle_tools_list(req_id):
    send_response(req_id, {
        "tools": [
            {
                "name": "voice_reply",
                "description": (
                    "Speak a response aloud through the choir TTS system. "
                    "Use this to reply to voice channel messages. "
                    "The text will be spoken through multiple blended voices."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The text to speak aloud",
                        },
                    },
                    "required": ["text"],
                },
            },
            {
                "name": "voice_status",
                "description": "Get the current status of the voice channel (listening, recording, speaking, etc.)",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                },
            },
        ],
    })


def handle_tool_call(req_id, name, arguments):
    global is_speaking

    if name == "voice_reply":
        text = arguments.get("text", "")
        if not text:
            send_response(req_id, {
                "content": [{"type": "text", "text": "No text provided"}],
                "isError": True,
            })
            return

        is_speaking = True
        try:
            speak_func = _get_speak_func()
            # Redirect stdout to stderr during TTS — voice_chat.py uses print()
            # which would corrupt the MCP JSON-RPC stream on stdout
            real_stdout = sys.stdout
            sys.stdout = sys.stderr
            try:
                loop = asyncio.new_event_loop()
                loop.run_until_complete(speak_func(text))
                loop.close()
            finally:
                sys.stdout = real_stdout
            send_response(req_id, {
                "content": [{"type": "text", "text": f"Spoke: {text[:50]}..."}],
            })
        except Exception as e:
            send_response(req_id, {
                "content": [{"type": "text", "text": f"TTS error: {e}"}],
                "isError": True,
            })
        finally:
            is_speaking = False

    elif name == "voice_status":
        send_response(req_id, {
            "content": [{"type": "text", "text": json.dumps({
                "state": vad_state,
                "awake": _awake,
                "is_speaking": is_speaking,
                "voice_pool_size": len(VOICE_POOL),
                "messages_received": _msg_counter,
            })}],
        })

    else:
        send_error(req_id, -32601, f"Unknown tool: {name}")


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    # Write startup log to file so we can diagnose MCP launch failures
    _logfile = Path(__file__).parent / "voice_server.log"
    try:
        with open(_logfile, "a") as f:
            import datetime
            f.write(f"\n--- {datetime.datetime.now().isoformat()} ---\n")
            f.write(f"pid={os.getpid()} cwd={os.getcwd()}\n")
            f.write(f"env PATH={os.environ.get('PATH','MISSING')}\n")
            f.write(f"env HOME={os.environ.get('HOME','MISSING')}\n")
            f.write(f"ELEVENLABS_API_KEY={'present' if ELEVENLABS_API_KEY else 'MISSING'}\n")
    except Exception:
        pass

    if not ELEVENLABS_API_KEY:
        # Log to file only — no stderr before handshake
        try:
            with open(_logfile, "a") as f:
                f.write("ERROR: ELEVENLABS_API_KEY missing\n")
        except Exception:
            pass
        sys.exit(1)

    # NO stderr output before handshake — Claude Code may interpret it as failure

    input_stream = None

    # Main loop: handle MCP messages from stdin
    # Mic and voice processor start AFTER the MCP handshake completes,
    # so Claude Code doesn't time out waiting for the initialize response.
    try:
        while True:
            msg = read_message()
            if msg is None:
                log("stdin closed, shutting down")
                break

            method = msg.get("method", "")
            req_id = msg.get("id")
            params = msg.get("params", {})

            # Log to file before handshake, stderr after
            try:
                with open(_logfile, "a") as f:
                    f.write(f"recv: {method} id={req_id}\n")
            except Exception:
                pass

            if method == "initialize":
                handle_initialize(req_id, params)
                try:
                    with open(_logfile, "a") as f:
                        f.write("sent initialize response\n")
                except Exception:
                    pass
            elif method == "notifications/initialized":
                # Handshake complete — now load heavy deps and start mic
                _load_heavy_imports()
                input_stream = sd.InputStream(
                    samplerate=SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype=DTYPE,
                    callback=audio_callback,
                    blocksize=BLOCKSIZE,
                )
                input_stream.start()
                log(f"mic active (threshold={VAD_ENERGY_THRESHOLD}, silence={VAD_SILENCE_DURATION}s)")

                processor = threading.Thread(target=voice_processor, daemon=True)
                processor.start()
                log("voice processor started")

                _initialized.set()
                log("client initialized — channel active")
            elif method == "tools/list":
                handle_tools_list(req_id)
            elif method == "tools/call":
                name = params.get("name", "")
                arguments = params.get("arguments", {})
                handle_tool_call(req_id, name, arguments)
            elif method == "ping":
                send_response(req_id, {})
            elif req_id is not None:
                send_error(req_id, -32601, f"Unknown method: {method}")
            # Ignore unknown notifications
    except KeyboardInterrupt:
        log("interrupted")
    finally:
        if input_stream is not None:
            input_stream.stop()
            input_stream.close()
        log("shutdown complete")


if __name__ == "__main__":
    main()
