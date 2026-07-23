#!/usr/bin/env python3
"""Smoke-test the discord-voice MCP server over stdio.

Drives the real launcher (run-discord-voice.sh) through an MCP handshake:
initialize -> tools/list -> voice_call_status, keeping stdin open so the
server doesn't shut down before responding (it exits on stdin EOF).

Usage:
    python3 tools/voice/smoke-discord-voice.py [--timeout 45]

Exit 0: handshake OK, voice_call tool advertised, status tool answered.
Exit 1: any step failed (details on stderr).

No call is placed; this validates startup, token resolution, security
config, and the MCP surface only.
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
    ap.add_argument("--timeout", type=float, default=45.0)
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

    # Reader thread: stdout.readline() blocks, so never call it on the main
    # thread — a silent server would hang the smoke past its own deadline.
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
    failures = []
    try:
        send(1, "initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "smoke", "version": "0"},
        })
        init = wait_for(1, deadline)
        if not init or "error" in init:
            failures.append(f"initialize failed: {init}")
        else:
            name = init["result"].get("serverInfo", {}).get("name")
            print(f"initialize OK (server: {name})")
            send(None, "notifications/initialized")

            send(2, "tools/list")
            tl = wait_for(2, deadline)
            tools = [t["name"] for t in (tl or {}).get("result", {}).get("tools", [])]
            if "voice_call" not in tools:
                failures.append(f"voice_call missing from tools/list: {tools}")
            else:
                print(f"tools/list OK: {tools}")

            send(3, "tools/call", {"name": "voice_call_status", "arguments": {}})
            st = wait_for(3, deadline)
            if not st or "error" in st:
                failures.append(f"voice_call_status failed: {st}")
            else:
                content = st["result"].get("content", [])
                text = content[0].get("text", "") if content else ""
                print(f"voice_call_status OK: {text[:200]}")
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        print("--- server stderr (tail) ---", file=sys.stderr)
        for line in stderr_lines[-15:]:
            print(line.rstrip(), file=sys.stderr)
        return 1
    print("SMOKE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
