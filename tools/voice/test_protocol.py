#!/usr/bin/env python3
"""
MCP protocol test for voice_server.py.

Acts as a fake MCP client: spawns the voice server as a subprocess with piped
stdio, sends Content-Length framed JSON-RPC 2.0 messages, and validates every
response against the MCP specification.

Usage:
    python3 test_protocol.py

Exit code 0 = all tests passed, 1 = at least one failure.
"""

import json
import os
import select
import subprocess
import sys
import time

# ── Config ───────────────────────────────────────────────────────────────────

VENV_PYTHON = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python3"
)
SERVER_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "voice_server.py"
)
TIMEOUT = 10  # seconds per exchange


# ── Framing helpers ──────────────────────────────────────────────────────────

def send_message(proc, msg: dict) -> None:
    """Send a Content-Length framed JSON-RPC message to the server's stdin."""
    body = json.dumps(msg).encode()
    header = f"Content-Length: {len(body)}\r\n\r\n".encode()
    proc.stdin.write(header + body)
    proc.stdin.flush()


def _read_bytes(fd: int, count: int, deadline: float) -> bytes:
    """
    Read exactly `count` bytes from raw file descriptor `fd`.
    Uses select + os.read to avoid Python buffered-IO vs select conflicts.
    Returns the bytes, or raises TimeoutError / EOFError.
    """
    buf = b""
    while len(buf) < count:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"timeout after reading {len(buf)}/{count} bytes")
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            raise TimeoutError(f"select timeout after reading {len(buf)}/{count} bytes")
        chunk = os.read(fd, count - len(buf))
        if not chunk:
            raise EOFError(f"EOF after reading {len(buf)}/{count} bytes")
        buf += chunk
    return buf


def read_message(stdout_fd: int, timeout: float = TIMEOUT) -> dict | None:
    """
    Read a Content-Length framed JSON-RPC message from a raw file descriptor.
    Returns None on timeout or EOF.
    """
    deadline = time.monotonic() + timeout

    # Read headers byte-by-byte until we see \r\n\r\n
    header_buf = b""
    try:
        while not header_buf.endswith(b"\r\n\r\n"):
            b = _read_bytes(stdout_fd, 1, deadline)
            header_buf += b
    except (TimeoutError, EOFError):
        return None

    # Parse headers
    headers: dict[str, str] = {}
    for line in header_buf.decode().split("\r\n"):
        if ":" in line:
            key, val = line.split(":", 1)
            headers[key.strip()] = val.strip()

    content_length = int(headers.get("Content-Length", "0"))
    if content_length == 0:
        return None

    # Read body
    try:
        data = _read_bytes(stdout_fd, content_length, deadline)
    except (TimeoutError, EOFError):
        return None

    return json.loads(data.decode())


# ── Test runner ──────────────────────────────────────────────────────────────

results: list[tuple[str, bool, str]] = []


def record(name: str, passed: bool, detail: str = "") -> None:
    tag = "PASS" if passed else "FAIL"
    line = f"  [{tag}] {name}"
    if detail:
        line += f" -- {detail}"
    print(line)
    results.append((name, passed, detail))


def main() -> int:
    # Spawn voice_server.py
    env = os.environ.copy()
    env["ELEVENLABS_API_KEY"] = "test-dummy-key"
    env["VOICE_TEST_MODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"

    print(f"Spawning: {VENV_PYTHON} {SERVER_SCRIPT}\n")
    proc = subprocess.Popen(
        [VENV_PYTHON, SERVER_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    # Use raw fd for reading to avoid buffered-IO vs select conflicts
    stdout_fd = proc.stdout.fileno()

    try:
        # ── Test 1: initialize ───────────────────────────────────────────
        send_message(proc, {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test_protocol", "version": "0.1.0"},
            },
        })
        resp = read_message(stdout_fd)
        if resp is None:
            record("initialize", False, "no response (timeout or EOF)")
        else:
            result = resp.get("result", {})
            checks = [
                ("protocolVersion" in result, "missing protocolVersion"),
                (
                    "tools" in result.get("capabilities", {}),
                    "missing capabilities.tools",
                ),
                (
                    "claude/channel"
                    in result.get("capabilities", {}).get("experimental", {}),
                    "missing capabilities.experimental['claude/channel']",
                ),
                ("serverInfo" in result, "missing serverInfo"),
                (resp.get("id") == 1, f"wrong id: {resp.get('id')}"),
            ]
            failures = [msg for ok, msg in checks if not ok]
            if failures:
                record("initialize", False, "; ".join(failures))
            else:
                record(
                    "initialize",
                    True,
                    f"v={result['protocolVersion']} "
                    f"server={result['serverInfo'].get('name')}",
                )

        # ── Test 2: notifications/initialized ────────────────────────────
        # Notification (no id) -- server must NOT send a response.
        send_message(proc, {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })
        # Short timeout: we expect silence.
        unexpected = read_message(stdout_fd, timeout=2.0)
        if unexpected is None:
            record("notifications/initialized", True, "no response (correct)")
        else:
            record(
                "notifications/initialized",
                False,
                f"unexpected response: {json.dumps(unexpected)[:120]}",
            )

        # Let the server finish heavy imports / mic init before next request.
        time.sleep(1.0)

        # ── Test 3: tools/list ───────────────────────────────────────────
        send_message(proc, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        })
        resp = read_message(stdout_fd)
        if resp is None:
            record("tools/list", False, "no response")
        else:
            tools = resp.get("result", {}).get("tools", [])
            tool_names = {t.get("name") for t in tools}
            missing = {"voice_reply", "voice_status"} - tool_names
            if missing:
                record("tools/list", False, f"missing tools: {missing}")
            elif resp.get("id") != 2:
                record("tools/list", False, f"wrong id: {resp.get('id')}")
            else:
                no_schema = [
                    t["name"] for t in tools if "inputSchema" not in t
                ]
                if no_schema:
                    record(
                        "tools/list",
                        False,
                        f"tools missing inputSchema: {no_schema}",
                    )
                else:
                    record(
                        "tools/list",
                        True,
                        f"{len(tools)} tool(s): {sorted(tool_names)}",
                    )

        # ── Test 4: tools/call voice_status ──────────────────────────────
        send_message(proc, {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "voice_status", "arguments": {}},
        })
        resp = read_message(stdout_fd)
        if resp is None:
            record("tools/call voice_status", False, "no response")
        else:
            result = resp.get("result", {})
            content = result.get("content", [])
            if resp.get("id") != 3:
                record(
                    "tools/call voice_status",
                    False,
                    f"wrong id: {resp.get('id')}",
                )
            elif not content:
                record("tools/call voice_status", False, "empty content")
            else:
                text_item = content[0]
                if text_item.get("type") != "text":
                    record(
                        "tools/call voice_status",
                        False,
                        f"content type={text_item.get('type')}, expected text",
                    )
                else:
                    try:
                        state = json.loads(text_item["text"])
                        expected_keys = {"state", "awake", "is_speaking"}
                        present = expected_keys & set(state.keys())
                        if present != expected_keys:
                            record(
                                "tools/call voice_status",
                                False,
                                f"missing keys: {expected_keys - present}",
                            )
                        else:
                            record(
                                "tools/call voice_status",
                                True,
                                f"state={state.get('state')} "
                                f"awake={state.get('awake')}",
                            )
                    except (json.JSONDecodeError, KeyError) as e:
                        record(
                            "tools/call voice_status",
                            False,
                            f"bad JSON in content: {e}",
                        )

        # ── Test 5: ping ─────────────────────────────────────────────────
        send_message(proc, {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "ping",
            "params": {},
        })
        resp = read_message(stdout_fd)
        if resp is None:
            record("ping", False, "no response")
        elif resp.get("id") != 4:
            record("ping", False, f"wrong id: {resp.get('id')}")
        elif "error" in resp:
            record("ping", False, f"error: {resp['error']}")
        else:
            record("ping", True, "pong")

        # ── Test 6: clean shutdown ───────────────────────────────────────
        proc.stdin.close()
        try:
            exit_code = proc.wait(timeout=5)
            if exit_code == 0:
                record("clean shutdown", True, "exit code 0")
            else:
                stderr_tail = ""
                try:
                    stderr_tail = proc.stderr.read(512).decode(
                        errors="replace"
                    )
                except Exception:
                    pass
                record(
                    "clean shutdown",
                    False,
                    f"exit code {exit_code}"
                    + (f" stderr: {stderr_tail[:200]}" if stderr_tail else ""),
                )
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            record("clean shutdown", False, "process did not exit within 5s")

    except Exception as exc:
        print(f"\n  [ERROR] Unexpected exception: {exc}")
        import traceback
        traceback.print_exc()
        proc.kill()
        proc.wait()

    # ── Summary ──────────────────────────────────────────────────────────
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    total = len(results)

    print(f"\n{'=' * 50}")
    print(f"  {passed}/{total} passed, {failed} failed")
    print(f"{'=' * 50}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
