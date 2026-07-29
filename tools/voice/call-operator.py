#!/usr/bin/env python3
"""Place a Discord voice call to the operator via the discord-voice MCP server.

Drives run-discord-voice.sh over stdio (newline-delimited JSON-RPC), calls
the voice_call tool with a spoken summary, and prints the operator's
transcribed reply to stdout. Lets any session (or script) place a call
without the MCP server being session-attached.

Usage:
    python3 tools/voice/call-operator.py "Summary text to speak" [--timeout 180]

Exit 0: call completed; transcript (or server text) on stdout.
Exit 1: failure (details on stderr).

Security is enforced server-side (single allowed user, fixed guild/channel,
cooldown, inactivity disconnect) — see discord_security.py.
"""

import argparse
import json
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

LAUNCHER = Path(__file__).parent / "run-discord-voice.sh"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("summary", help="Text to speak to the operator")
    ap.add_argument("--timeout", type=float, default=180.0,
                    help="Overall deadline incl. TTS + listen window (s)")
    args = ap.parse_args()

    proc = subprocess.Popen(
        [str(LAUNCHER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stderr_lines: list[str] = []
    threading.Thread(
        target=lambda: stderr_lines.extend(iter(proc.stderr.readline, "")),
        daemon=True,
    ).start()

    inbox: queue.Queue = queue.Queue()

    def _pump_stdout():
        for line in iter(proc.stdout.readline, ""):
            try:
                inbox.put(json.loads(line))
            except json.JSONDecodeError:
                continue

    threading.Thread(target=_pump_stdout, daemon=True).start()

    results: dict[int, dict] = {}

    def send(req_id, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if req_id is not None:
            msg["id"] = req_id
        if params is not None:
            msg["params"] = params
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    def wait_for(req_id, deadline):
        while time.time() < deadline:
            if req_id in results:
                return results[req_id]
            try:
                msg = inbox.get(timeout=0.25)
            except queue.Empty:
                continue
            if isinstance(msg, dict) and "id" in msg:
                results[msg["id"]] = msg
        return results.get(req_id)

    deadline = time.time() + args.timeout
    try:
        send(1, "initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "call-operator", "version": "1.0"},
        })
        if not wait_for(1, time.time() + 30):
            print("FAIL: initialize timed out", file=sys.stderr)
            return 1
        send(None, "notifications/initialized")

        send(2, "tools/call", {
            "name": "voice_call",
            "arguments": {"summary": args.summary},
        })
        resp = wait_for(2, deadline)
        if not resp:
            print("FAIL: voice_call timed out", file=sys.stderr)
            return 1
        if "error" in resp:
            print(f"FAIL: {resp['error']}", file=sys.stderr)
            return 1
        for block in resp["result"].get("content", []):
            if block.get("type") == "text":
                print(block["text"])
        return 0
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        for line in stderr_lines[-12:]:
            print(f"  [server] {line.rstrip()}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
