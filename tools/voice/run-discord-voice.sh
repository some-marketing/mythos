#!/usr/bin/env bash
# Mythos Discord Voice Callback Server Launcher
#
# Launches the Discord voice callback MCP server with secure token injection.
# Fetches Discord bot token from 1Password or macOS Keychain.
#
# Token resolution (in order of priority):
#   1. DISCORD_BOT_TOKEN env var (already set)
#   2. 1Password: op://{VAULT}/DISCORD_BOT_TOKEN/credential
#   3. macOS Keychain: mythos-discord-bot-token / Mythos
#
# Usage (normally invoked by .mcp.json):
#   tools/voice/run-discord-voice.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="${SCRIPT_DIR}/.venv/bin/python3"

# ── resolve dependencies ──────────────────────────────────────────────────────────

if [[ ! -f "${VENV_PYTHON}" ]]; then
    echo "[discord-voice] Virtual environment not found at ${VENV_PYTHON}" >&2
    echo "[discord-voice] Please run: cd tools/voice && python3 -m venv .venv" >&2
    echo "[discord-voice] Then: source .venv/bin/activate && pip install -r requirements.txt" >&2
    exit 1
fi

# ── resolve Discord token ──────────────────────────────────────────────────

OP_VAULT="${DISCORD_OP_VAULT:-{VAULT}}"
OP_ITEM="${DISCORD_OP_ITEM:-DISCORD_BOT_TOKEN}"
OP_FIELD="${DISCORD_OP_FIELD:-credential}"
KC_SERVICE="${DISCORD_KC_SERVICE:-mythos-discord-bot-token}"
KC_ACCOUNT="${DISCORD_KC_ACCOUNT:-Mythos}"

TOKEN=""

# 1. Check direct env var
if [[ -n "${DISCORD_BOT_TOKEN:-}" ]]; then
    TOKEN="${DISCORD_BOT_TOKEN}"
fi

# 2. Try 1Password (with 5s timeout)
if [[ -z "${TOKEN}" ]] && command -v op >/dev/null 2>&1; then
    TOKEN=$(timeout 5 op read "op://${OP_VAULT}/${OP_ITEM}/${OP_FIELD}" 2>/dev/null || true)
fi

# 3. Try macOS Keychain
if [[ -z "${TOKEN}" ]] && command -v security >/dev/null 2>&1; then
    TOKEN=$(security find-generic-password -a "${KC_ACCOUNT}" -s "${KC_SERVICE}" -w 2>/dev/null || true)
fi

# Clean token (strip newlines and non-printable)
if [[ -n "${TOKEN}" ]]; then
    TOKEN=$(printf '%s' "${TOKEN}" | LC_ALL=C tr -cd '!-~')
fi

if [[ -z "${TOKEN}" ]]; then
    echo "[discord-voice] DISCORD_BOT_TOKEN not found." >&2
    echo "[discord-voice]   Tried env var DISCORD_BOT_TOKEN" >&2
    echo "[discord-voice]   Tried 1Password op://${OP_VAULT}/${OP_ITEM}/${OP_FIELD}" >&2
    echo "[discord-voice]   Tried Keychain service '${KC_SERVICE}' account '${KC_ACCOUNT}'" >&2
    echo "[discord-voice]   Store with: /store-credential ${KC_SERVICE} ${KC_ACCOUNT}" >&2
    exit 1
fi

# ── launch server ───────────────────────────────────────────────────────────────────

export DISCORD_BOT_TOKEN="${TOKEN}"
unset TOKEN

# Verify opus is loadable (mirror the server's explicit Homebrew-path loader —
# bare is_loaded() is always False on macOS until load_opus is called)
if ! "${VENV_PYTHON}" -c "
import discord
for p in ('/opt/homebrew/lib/libopus.dylib', '/usr/local/lib/libopus.dylib', 'opus'):
    try:
        discord.opus.load_opus(p); break
    except OSError:
        continue
exit(0 if discord.opus.is_loaded() else 1)" 2>/dev/null; then
    echo "[discord-voice] Warning: Discord opus not loaded. Voice may fail." >&2
    echo "[discord-voice]   Install with: brew install opus libsodium ffmpeg" >&2
fi

# Launch the MCP server
exec "${VENV_PYTHON}" "${SCRIPT_DIR}/discord_callback_server.py"
