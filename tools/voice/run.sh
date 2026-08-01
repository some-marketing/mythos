#!/usr/bin/env bash
# Launch Claude Voice Chat
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV"
    source "$VENV/bin/activate"
    pip install -r "$SCRIPT_DIR/requirements.txt"
else
    source "$VENV/bin/activate"
fi

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "ERROR: No .env file found. Copy .env.example to .env and fill in your API keys."
    echo "  cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
    exit 1
fi

exec python3 "$SCRIPT_DIR/voice_chat.py" "$@"
