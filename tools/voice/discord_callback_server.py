#!/usr/bin/env python3
"""
Discord Voice Callback MCP Server

Provides voice_call MCP tool that:
1. Connects bot to Discord voice channel
2. Speaks TTS summary via ElevenLabs (via voice_chat.py)
3. Listens for user response via Discord voice receive
4. Transcribes via local Whisper
5. Returns transcription to Claude
6. Auto-disconnects after inactivity

Usage:
    python discord_callback_server.py

Requires environment variables (see .env.example):
    - DISCORD_BOT_TOKEN
    - DISCORD_GUILD_ID
    - DISCORD_VOICE_CHANNEL_ID
    - DISCORD_ALLOWED_USER_ID
    - ELEVENLABS_API_KEY (for TTS)
"""

# Force unbuffered stdout/stderr for pipe communication with Claude Code
import os
os.environ.setdefault("PYTHONUNBUFFERED", "1")

import asyncio
import io
import json
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Optional

import numpy as np

# Load .env from the voice tools directory
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Discord imports (py-cord with voice receive)
import discord
from discord.ext import commands

# py-cord can't find Homebrew's libopus on macOS without an explicit path;
# without it TTS playback fails at VoiceClient.play (encoder unavailable).
if not discord.opus.is_loaded():
    for _opus_path in (
        os.environ.get("OPUS_LIB_PATH"),
        "/opt/homebrew/lib/libopus.dylib",
        "/usr/local/lib/libopus.dylib",
        "opus",
    ):
        if not _opus_path:
            continue
        try:
            discord.opus.load_opus(_opus_path)
            break
        except OSError:
            continue

# Import security module
from discord_security import DiscordSecurity, SecurityError

# Import voice_chat functions for TTS
sys.path.insert(0, str(Path(__file__).parent))
from voice_chat import (
    speak_text,
    audio_bytes_to_numpy,
    _fetch_tts_audio,
    VOICE_POOL,
    ELEVENLABS_VOICE_ID,
)
import httpx

# ── Configuration ──────────────────────────────────────────────────────────

SAMPLE_RATE = 48000  # Discord uses 48kHz
CHANNELS = 2  # Discord is stereo
DISCORD_OPUS_FRAME_SIZE = 960  # 20ms at 48kHz

# Whisper config
WHISPER_MODEL = str(Path(__file__).parent / "models" / "ggml-base.en.bin")
WHISPER_CLI = "/opt/homebrew/bin/whisper-cli"

# State
_mcp_out = sys.stdout.buffer
_write_lock = threading.Lock()
_initialized = threading.Event()
_voice_client: Optional[discord.VoiceClient] = None
_security: Optional[DiscordSecurity] = None
_bot: Optional[commands.Bot] = None

# Audio buffer for STT
_audio_buffer: list[np.ndarray] = []
_buffer_lock = threading.Lock()
_recording = False
_listen_start_time: float = 0.0
LISTEN_TIMEOUT = 30.0  # Max seconds to listen for response


# ── Logging ────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    """Log to stderr (stdout is MCP protocol)."""
    sys.stderr.write(f"[discord-voice] {msg}\n")
    sys.stderr.flush()


# ── MCP Protocol (JSON-RPC 2.0 over stdio) ─────────────────────────────────

def write_message(msg: dict) -> None:
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


def read_message() -> Optional[dict]:
    """Read a JSON-RPC message from stdin.

    Primary: newline-delimited JSON (MCP stdio spec). Legacy fallback: if a
    line looks like an LSP 'Content-Length' header, honor that framing so
    old clients keep working.
    """
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        stripped = line.decode(errors="replace").strip()
        if not stripped:
            continue
        if stripped.startswith("{"):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                log(f"skipping unparseable line: {stripped[:120]}")
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


def send_notification(method: str, params: dict) -> None:
    """Send a JSON-RPC notification."""
    write_message({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })


def send_response(req_id, result: dict) -> None:
    """Send a JSON-RPC response."""
    write_message({
        "jsonrpc": "2.0",
        "id": req_id,
        "result": result,
    })


def send_error(req_id, code: int, message: str) -> None:
    """Send a JSON-RPC error response."""
    write_message({
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    })


# ── Audio Utilities ────────────────────────────────────────────────────────

def chunks_to_wav_bytes(chunks: list, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Convert numpy audio chunks to WAV bytes."""
    if not chunks:
        return b""
    audio_data = np.concatenate(chunks, axis=0)
    # Ensure int16
    if audio_data.dtype != np.int16:
        audio_data = np.clip(audio_data, -32768, 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
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


# ── Whisper STT ────────────────────────────────────────────────────────────

async def transcribe_audio(wav_bytes: bytes) -> str:
    """Transcribe audio using local whisper-cpp."""
    if not wav_bytes or len(wav_bytes) < 1000:
        return ""

    # Check if whisper-cli exists
    if not Path(WHISPER_CLI).exists():
        log(f"Whisper CLI not found at {WHISPER_CLI}")
        return "(whisper not available)"

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
        result = stdout.decode("utf-8", errors="replace").strip()
        return clean_transcription(result)
    except Exception as e:
        log(f"STT error: {e}")
        return ""
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ── Discord Audio Sink ─────────────────────────────────────────────────────

class WhisperAudioSink(discord.sinks.Sink):
    """
    Custom audio sink that buffers incoming Discord audio for STT.
    
    Inherits from discord.sinks.Sink for voice receive support.
    """

    def __init__(self):
        super().__init__()
        self.audio_data = {}  # user_id -> list of packets
        self.bytes_received = 0

    def write(self, data, user):
        """Called by discord when audio packet received."""
        global _audio_buffer

        if user is None:
            return

        # py-cord passes the raw user id (int) here, not a User object —
        # calling .id on it raises inside the receive thread and silently
        # drops every packet ("No audio detected").
        user_id = str(getattr(user, "id", user))

        # Only listen to allowed user
        if _security and user_id != _security.allowed_user_id:
            return

        if not _recording:
            return

        # Decode Opus to PCM (py-cord's AudioData handles this)
        # The data is already decoded PCM from discord.sinks
        with _buffer_lock:
            # Convert bytes to numpy array (int16, stereo)
            pcm_data = np.frombuffer(data, dtype=np.int16)
            _audio_buffer.append(pcm_data.copy())
            self.bytes_received += len(data)

    def cleanup(self):
        """Clean up audio data."""
        self.audio_data.clear()


# ── Discord Bot Setup ──────────────────────────────────────────────────────

class DiscordVoiceBot(commands.Bot):
    """Discord bot with voice receive capability."""

    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.voice_states = True
        intents.guild_messages = True

        super().__init__(
            command_prefix="!",
            intents=intents,
        )
        self.voice_client: Optional[discord.VoiceClient] = None
        self.ready_event = asyncio.Event()

    async def on_ready(self):
        """Called when bot connects to Discord."""
        log(f"Bot connected as {self.user} ({self.user.id})")
        self.ready_event.set()

    async def on_voice_state_update(self, member, before, after):
        """Track voice state changes."""
        if member.id == self.user.id:
            if after.channel is None:
                log("Bot disconnected from voice channel")
            else:
                log(f"Bot connected to voice channel: {after.channel.name}")


async def get_bot() -> DiscordVoiceBot:
    """Get or create the Discord bot instance."""
    global _bot
    if _bot is None:
        _bot = DiscordVoiceBot()
    return _bot


# ── Voice Call Implementation ──────────────────────────────────────────────

async def perform_voice_call(summary: str) -> str:
    """
    Execute the voice call sequence.

    1. Connect to Discord voice channel
    2. Speak summary via TTS
    3. Listen for user response
    4. Transcribe and return
    5. Disconnect
    """
    global _voice_client, _recording, _audio_buffer, _security

    if _security is None:
        return "Error: Security module not initialized"

    # Validate config
    try:
        _security.validate_configuration()
    except SecurityError as e:
        return f"Configuration error: {e}"

    # Check rate limit
    allowed, remaining = _security.check_rate_limit()
    if not allowed:
        _security.audit_rate_limit_hit()
        return f"Rate limited. Please wait {int(remaining)} seconds before next call."

    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "")
    if not bot_token:
        return "Error: DISCORD_BOT_TOKEN not set"

    bot = await get_bot()

    # Start bot if not already running
    if not bot.is_ready():
        try:
            # Run bot in background task
            asyncio.create_task(bot.start(bot_token))
            # Wait for ready
            await asyncio.wait_for(bot.ready_event.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            return "Error: Bot failed to connect to Discord within 30 seconds"
        except Exception as e:
            return f"Error starting bot: {e}"

    # Get guild and channel
    guild = bot.get_guild(int(_security.guild_id))
    if guild is None:
        # Try fetching guilds
        guilds = [g async for g in bot.fetch_guilds()]
        for g in guilds:
            if str(g.id) == _security.guild_id:
                guild = g
                break

    if guild is None:
        _security.audit_join_attempt(None, _security.channel_id, None, False)
        return f"Error: Guild {_security.guild_id[:4]}*** not found or bot not a member"

    # Security check: Guild allowlist
    if not _security.check_guild_allowed(str(guild.id)):
        _security.audit_join_attempt(str(guild.id), None, None, False)
        return "Error: Guild not in allowlist"

    # Get voice channel
    voice_channel = None
    for vc in guild.voice_channels:
        if str(vc.id) == _security.channel_id:
            voice_channel = vc
            break

    if voice_channel is None:
        _security.audit_join_attempt(str(guild.id), _security.channel_id, None, False)
        return f"Error: Voice channel not found"

    # Check if user is in the channel
    allowed_user_in_channel = False
    for member in voice_channel.members:
        if str(member.id) == _security.allowed_user_id:
            allowed_user_in_channel = True
            break

    if not allowed_user_in_channel:
        log(f"Allowed user {_security.allowed_user_id[:4]}*** not in channel")
        # We'll still proceed but user won't be heard

    # Connect to voice channel
    try:
        _voice_client = await voice_channel.connect()
        _security.audit_join_attempt(str(guild.id), str(voice_channel.id),
                                     _security.allowed_user_id, True)
    except Exception as e:
        _security.audit_join_attempt(str(guild.id), str(voice_channel.id),
                                     _security.allowed_user_id, False)
        return f"Error connecting to voice channel: {e}"

    call_start_time = time.monotonic()
    _security.record_call()
    _security.audit_call_started(summary)

    try:
        # Step 1: Speak summary INTO the Discord voice channel (ElevenLabs ->
        # mp3 -> FFmpegPCMAudio -> voice client). Local speakers are only the
        # fallback — the operator on the other end must hear this.
        log("Speaking summary into Discord voice channel...")
        try:
            vid = VOICE_POOL[0] if VOICE_POOL else ELEVENLABS_VOICE_ID
            async with httpx.AsyncClient() as tts_client:
                tts_bytes = await _fetch_tts_audio(tts_client, vid, summary)
            tts_path = None
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
                tf.write(tts_bytes)
                tts_path = tf.name
            playback_done = asyncio.Event()
            loop = asyncio.get_running_loop()

            def _after_playback(err):
                if err:
                    log(f"Discord playback error: {err}")
                loop.call_soon_threadsafe(playback_done.set)

            _voice_client.play(discord.FFmpegPCMAudio(tts_path), after=_after_playback)
            await asyncio.wait_for(playback_done.wait(), timeout=120.0)
            try:
                os.unlink(tts_path)
            except OSError:
                pass
            log("Discord TTS playback complete")
        except Exception as e:
            log(f"Discord TTS playback failed: {e}; falling back to local speakers")
            try:
                await speak_text(summary)
            except Exception as e2:
                log(f"Local TTS fallback error: {e2}")

        # Step 2: Start listening for response
        log("Starting voice recording...")
        _audio_buffer = []
        _recording = True
        _listen_start_time = time.monotonic()

        # Start audio sink for receiving — py-cord voice receive is driven by
        # VoiceClient.start_recording(sink, async_callback). Use the stock
        # WaveSink (a hand-rolled Sink subclass misses py-cord's listener
        # plumbing — '__sink_listeners__'). The sink's per-user BytesIO grows
        # live; on stop_recording the callback receives wav-formatted audio.
        audio_sink = discord.sinks.WaveSink()
        captured_wavs: list[bytes] = []
        recording_done = asyncio.Event()

        async def _recording_finished(sink, *args):
            try:
                for uid, audio in sink.audio_data.items():
                    if _security and str(uid) != _security.allowed_user_id:
                        continue
                    audio.file.seek(0)
                    captured_wavs.append(audio.file.read())
                log(f"Recording finished ({sum(len(w) for w in captured_wavs)} wav bytes from allowed user)")
            except Exception as e:
                log(f"recording-finished error: {e}")
            finally:
                recording_done.set()

        recording_started = False
        try:
            _voice_client.start_recording(audio_sink, _recording_finished)
            recording_started = True
        except Exception as e:
            log(f"start_recording failed: {e}")
            recording_done.set()

        def _capture_size() -> int:
            try:
                return sum(
                    a.file.getbuffer().nbytes for a in audio_sink.audio_data.values()
                )
            except Exception:
                return 0

        # Silence detection keyed to capture GROWTH (a non-growing capture
        # means the user stopped talking; mere presence would reset the
        # silence clock forever).
        silence_duration = 0.0
        last_audio_time = time.monotonic()
        prev_size = 0

        while _recording and _voice_client and _voice_client.is_connected():
            await asyncio.sleep(0.1)

            elapsed = time.monotonic() - _listen_start_time

            # Timeout check
            if elapsed > LISTEN_TIMEOUT:
                log("Listen timeout reached")
                break

            cur_size = _capture_size()
            if cur_size > prev_size:
                prev_size = cur_size
                last_audio_time = time.monotonic()
                silence_duration = 0.0
            else:
                silence_duration = time.monotonic() - last_audio_time

            # If we've been silent for 3 seconds and have data, stop
            if silence_duration > 3.0 and cur_size > 0:
                # Wait a bit more for trailing audio
                await asyncio.sleep(1.0)
                break

            # If no audio for 10 seconds, give up
            if silence_duration > 10.0 and cur_size == 0:
                log("No audio detected from user")
                break

        _recording = False
        if recording_started:
            try:
                _voice_client.stop_recording()
            except Exception as e:
                log(f"stop_recording error: {e}")
            try:
                await asyncio.wait_for(recording_done.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                log("recording-finished callback timed out")
        # Step 3: Transcribe the audio. WaveSink already emits a complete
        # WAV per user — hand it to Whisper directly rather than re-encoding
        # through chunks_to_wav_bytes (whose 48kHz-stereo header assumptions
        # don't match the sink output).
        wav_bytes = b""
        for wav in captured_wavs:
            if wav and len(wav) > 44:  # more than a bare WAV header
                wav_bytes = wav
                break
        if wav_bytes:
            log(f"Transcribing {len(wav_bytes)} bytes of captured audio...")
        else:
            with _buffer_lock:
                if len(_audio_buffer) > 0:
                    log(f"Transcribing {len(_audio_buffer)} legacy buffer chunks...")
                    wav_bytes = chunks_to_wav_bytes(_audio_buffer)
                    _audio_buffer = []

        if wav_bytes:
            transcription = await transcribe_audio(wav_bytes)
        else:
            transcription = "(no audio received)"

        duration = time.monotonic() - call_start_time
        _security.audit_call_ended(transcription, duration)

        return transcription

    except Exception as e:
        log(f"Error during voice call: {e}")
        return f"Error during voice call: {e}"

    finally:
        # Step 4: Disconnect
        if _voice_client and _voice_client.is_connected():
            try:
                await _voice_client.disconnect()
                _security.audit_disconnect("normal")
            except Exception as e:
                log(f"Error disconnecting: {e}")
        _voice_client = None


# ── MCP Request Handlers ───────────────────────────────────────────────────

def handle_initialize(req_id, params):
    """Handle MCP initialize request."""
    send_response(req_id, {
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {},
        },
        "serverInfo": {
            "name": "discord-voice",
            "version": "1.0.0",
        },
    })


def handle_tools_list(req_id):
    """Handle MCP tools/list request."""
    send_response(req_id, {
        "tools": [
            {
                "name": "voice_call",
                "description": (
                    "Call {OPERATOR_NAME} on Discord to debrief. Bot joins voice channel, "
                    "speaks summary via TTS, listens for response, transcribes it, "
                    "and returns the transcription. Auto-disconnects after."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "What to tell {OPERATOR_NAME}",
                        },
                    },
                    "required": ["summary"],
                },
            },
            {
                "name": "voice_call_status",
                "description": "Get status of Discord voice callback server",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                },
            },
        ],
    })


def handle_tool_call(req_id, name, arguments):
    """Handle MCP tools/call request."""
    if name == "voice_call":
        summary = arguments.get("summary", "")
        if not summary:
            send_response(req_id, {
                "content": [{"type": "text", "text": "No summary provided"}],
                "isError": True,
            })
            return

        # Run voice call in async context
        async def do_call():
            result = await perform_voice_call(summary)
            return result

        try:
            result = asyncio.run(do_call())
            send_response(req_id, {
                "content": [{"type": "text", "text": result}],
            })
        except Exception as e:
            log(f"Voice call error: {e}")
            send_response(req_id, {
                "content": [{"type": "text", "text": f"Error: {e}"}],
                "isError": True,
            })

    elif name == "voice_call_status":
        global _security
        if _security:
            stats = _security.get_stats()
            status = {
                "initialized": True,
                "stats": stats,
                "voice_client_connected": _voice_client is not None and _voice_client.is_connected() if _voice_client else False,
            }
        else:
            status = {"initialized": False}

        send_response(req_id, {
            "content": [{"type": "text", "text": json.dumps(status, indent=2)}],
        })

    else:
        send_error(req_id, -32601, f"Unknown tool: {name}")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    global _security

    # Initialize security module
    _security = DiscordSecurity()

    # Log startup
    log("Discord Voice Callback MCP Server starting...")

    # Check Discord token presence (don't log the token)
    if not os.environ.get("DISCORD_BOT_TOKEN"):
        log("ERROR: DISCORD_BOT_TOKEN not set in environment")
        sys.exit(1)

    log("Security module initialized")
    log(f"  Guild: ***{_security.guild_id[-4:] if _security.guild_id else 'NOT SET'}")
    log(f"  Channel: ***{_security.channel_id[-4:] if _security.channel_id else 'NOT SET'}")
    log(f"  Allowed user: ***{_security.allowed_user_id[-4:] if _security.allowed_user_id else 'NOT SET'}")

    # Main MCP message loop
    try:
        while True:
            msg = read_message()
            if msg is None:
                log("stdin closed, shutting down")
                break

            method = msg.get("method", "")
            req_id = msg.get("id")
            params = msg.get("params", {})

            if method == "initialize":
                handle_initialize(req_id, params)
                _initialized.set()
            elif method == "notifications/initialized":
                log("MCP handshake complete")
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

    except KeyboardInterrupt:
        log("Interrupted")
    finally:
        # Cleanup
        if _voice_client and _voice_client.is_connected():
            try:
                asyncio.run(_voice_client.disconnect())
            except Exception:
                pass
        log("Shutdown complete")


if __name__ == "__main__":
    main()
