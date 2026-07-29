#!/usr/bin/env python3
"""
ElevenLabs Voice Picker — Browse, preview, and select a voice for Claude.

Usage:
  python pick_voice.py              # List all voices
  python pick_voice.py --preview    # List + play a sample of each
  python pick_voice.py --set        # List, pick, and save to .env
"""

import argparse
import io
import os
import sys
import tempfile
from pathlib import Path

import httpx
import sounddevice as sd
import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ENV_PATH = Path(__file__).parent / ".env"


def get_voices() -> list[dict]:
    """Fetch all available voices from ElevenLabs."""
    resp = httpx.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": ELEVENLABS_API_KEY},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json().get("voices", [])


def preview_voice(voice_id: str, voice_name: str):
    """Generate and play a short sample from a voice."""
    print(f"  Generating preview for {voice_name}...", end="", flush=True)
    resp = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/wav",
        },
        json={
            "text": f"Hi {OPERATOR_NAME}, I'm {voice_name}. This is what I sound like as your AI assistant.",
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30.0,
    )
    resp.raise_for_status()

    # Write to temp file and play
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(resp.content)
    tmp.close()

    try:
        import subprocess
        # Use afplay on macOS for reliable WAV playback
        print(" playing...", flush=True)
        subprocess.run(["afplay", tmp.name], check=True, timeout=15)
    except Exception as e:
        print(f" playback error: {e}")
    finally:
        os.unlink(tmp.name)


def save_voice_to_env(voice_id: str, voice_name: str):
    """Update ELEVENLABS_VOICE_ID in .env file."""
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text().splitlines()
    else:
        lines = []

    # Replace or append ELEVENLABS_VOICE_ID
    found = False
    for i, line in enumerate(lines):
        if line.startswith("ELEVENLABS_VOICE_ID=") or line.startswith("# ELEVENLABS_VOICE_ID="):
            lines[i] = f"ELEVENLABS_VOICE_ID={voice_id}  # {voice_name}"
            found = True
            break

    if not found:
        lines.append(f"ELEVENLABS_VOICE_ID={voice_id}  # {voice_name}")

    ENV_PATH.write_text("\n".join(lines) + "\n")
    print(f"\nSaved: {voice_name} ({voice_id}) → .env")


def display_voices(voices: list[dict]):
    """Display voice list in a readable table."""
    print(f"\n{'#':<4} {'Name':<25} {'Category':<15} {'Gender':<8} {'Accent':<15} {'Voice ID'}")
    print("-" * 90)

    for i, v in enumerate(voices, 1):
        labels = v.get("labels", {})
        name = v.get("name", "Unknown")
        category = v.get("category", "")
        gender = labels.get("gender", "")
        accent = labels.get("accent", "")
        vid = v.get("voice_id", "")
        print(f"{i:<4} {name:<25} {category:<15} {gender:<8} {accent:<15} {vid}")

    return voices


def main():
    parser = argparse.ArgumentParser(description="Browse and select ElevenLabs voices")
    parser.add_argument("--preview", action="store_true", help="Play a sample of selected voice")
    parser.add_argument("--set", action="store_true", help="Pick a voice and save to .env")
    args = parser.parse_args()

    if not ELEVENLABS_API_KEY:
        print("ERROR: Set ELEVENLABS_API_KEY in tools/voice/.env first")
        sys.exit(1)

    print("Fetching voices from ElevenLabs...")
    voices = get_voices()

    if not voices:
        print("No voices found. Check your API key.")
        sys.exit(1)

    # Group by category
    premade = [v for v in voices if v.get("category") == "premade"]
    cloned = [v for v in voices if v.get("category") == "cloned"]
    other = [v for v in voices if v.get("category") not in ("premade", "cloned")]

    all_voices = []
    if cloned:
        print(f"\n== Your Cloned Voices ({len(cloned)}) ==")
        all_voices.extend(cloned)
    if premade:
        print(f"\n== Premade Voices ({len(premade)}) ==")
        all_voices.extend(premade)
    if other:
        print(f"\n== Other Voices ({len(other)}) ==")
        all_voices.extend(other)

    display_voices(all_voices)
    print(f"\nTotal: {len(all_voices)} voices")

    current = os.environ.get("ELEVENLABS_VOICE_ID", "")
    if current:
        match = next((v for v in all_voices if v["voice_id"] == current), None)
        if match:
            print(f"Current selection: {match['name']} ({current})")

    if args.preview or args.set:
        print()
        while True:
            try:
                choice = input("Enter voice # to preview (or 'q' to quit): ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break

            if choice.lower() == "q":
                break

            try:
                idx = int(choice) - 1
                if 0 <= idx < len(all_voices):
                    v = all_voices[idx]
                    preview_voice(v["voice_id"], v["name"])

                    if args.set:
                        confirm = input(f"  Use {v['name']} as Claude's voice? (y/n): ").strip().lower()
                        if confirm == "y":
                            save_voice_to_env(v["voice_id"], v["name"])
                            break
                else:
                    print(f"  Pick a number between 1 and {len(all_voices)}")
            except ValueError:
                print("  Enter a number")


if __name__ == "__main__":
    main()
