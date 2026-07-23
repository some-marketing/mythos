#!/usr/bin/env bash
# Mythos Discord Voice Conversation Agent launcher.
# Resolves DISCORD_BOT_TOKEN (env > 1Password > Keychain), loads tools/voice/.env
# for guild/channel/user/ElevenLabs config, then execs the node agent.
# Token bytes never hit argv or disk.
#
# USAGE
#   ./run.sh            — normal full-duplex agent (TTS + STT)
#   ./run.sh --probe    — connect + instrument only, exit after 120s (no TTS)
#
# ── TEST PLAN (live receive verification) ───────────────────────────────────
# Launch:
#   ./tools/voice/discord-agent/run.sh --probe 2>&1 | tee /tmp/voice-probe.log &
#
# Monitor grep patterns (use Claude Code Monitor tool on the bg process, or tail):
#   AGENT_READY          — bot joined; receiver armed; DAVE negotiation in progress
#   SPEAKING_START       — gateway sees mic activity (confirms Discord gateway OK)
#   OPUS_BYTES           — one line/s per active stream; "0 0" = speaking event
#                          fired but zero packets (decrypt fail / DAVE not ready)
#   RECV_ERROR           — decrypt or decode error text
#   DAVE_DEBUG           — DAVE session state transitions
#   HEARD                — STT success (full mode only)
#
# Diagnostic matrix (operator speaks during probe window):
#   (a) No SPEAKING_START at all
#       → operator was not actually speaking during the listen window, OR
#         the bot does not have VOICE_STATE permission to see the user,  OR
#         ALLOWED_USER env does not match the operator's Discord user id.
#   (b) SPEAKING_START fires but no OPUS_BYTES line (or "0 0")
#       → speaking event fires from the SpeakingMap but the receive stream
#         received zero UDP packets; likely DAVE session not yet ready
#         (check DAVE_DEBUG lines for "Failed to decrypt" or "reinitializing").
#   (c) OPUS_BYTES shows packets>0 but no HEARD
#       → audio is decrypted and decoded; STT step is failing.
#         Check whisper model path and ffmpeg availability.
#   (d) RECV_ERROR lines present
#       → decrypt failure; check DAVE_DEBUG for transition/epoch state.
#
# Kill:
#   touch _dev/state/voice-conversation/disabled
#   # or SIGINT the process
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICE_DIR="$(dirname "${SCRIPT_DIR}")"

# Load non-secret voice config (guild/channel/user IDs, ElevenLabs key lives
# here too — the .env file is gitignored).
if [[ -f "${VOICE_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${VOICE_DIR}/.env"
  set +a
fi

OP_ITEM="${DISCORD_OP_ITEM:-DISCORD_BOT_TOKEN}"
OP_VAULT="${DISCORD_OP_VAULT:-Work Info}"
OP_FIELD="${DISCORD_OP_FIELD:-credential}"
KC_SERVICE="${DISCORD_KC_SERVICE:-mythos-discord-bot-token}"
KC_ACCOUNT="${DISCORD_KC_ACCOUNT:-Mythos}"

TOKEN="${DISCORD_BOT_TOKEN:-}"

if [[ -z "${TOKEN}" ]] && command -v op >/dev/null 2>&1; then
  TOKEN="$(timeout 3 op read "op://${OP_VAULT}/${OP_ITEM}/${OP_FIELD}" 2>/dev/null || true)"
fi
if [[ -z "${TOKEN}" ]] && command -v security >/dev/null 2>&1; then
  TOKEN="$(security find-generic-password -a "${KC_ACCOUNT}" -s "${KC_SERVICE}" -w 2>/dev/null || true)"
fi
TOKEN="$(printf '%s' "${TOKEN}" | LC_ALL=C tr -cd '!-~')"

if [[ -z "${TOKEN}" ]]; then
  echo "[voice-agent] DISCORD_BOT_TOKEN not found (env / 1Password / Keychain)" >&2
  exit 1
fi

if [[ ! -d "${SCRIPT_DIR}/node_modules" ]]; then
  echo "[voice-agent] installing dependencies..." >&2
  (cd "${SCRIPT_DIR}" && npm install --no-audit --no-fund) >&2
fi

export DISCORD_BOT_TOKEN="${TOKEN}"
unset TOKEN

# Pass through any CLI arguments (e.g. --probe) to the node agent
exec node "${SCRIPT_DIR}/index.mjs" "$@"
