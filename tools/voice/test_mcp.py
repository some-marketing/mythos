#!/usr/bin/env python3
"""Minimal MCP server — just responds to initialize and tools/list."""
import datetime
import json
import pathlib
import sys

_log_path = pathlib.Path(__file__).resolve().with_name("test_mcp.log")
_log = open(_log_path, "a")
_log.write(f"\n--- {datetime.datetime.now().isoformat()} started ---\n")
_log.flush()

def read_msg():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.decode().strip()
        if not line:
            break
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip()] = v.strip()
    length = int(headers.get("Content-Length", "0"))
    if not length:
        return None
    return json.loads(sys.stdin.buffer.read(length))

def write_msg(msg):
    data = json.dumps(msg)
    header = f"Content-Length: {len(data)}\r\n\r\n"
    sys.stdout.buffer.write(header.encode() + data.encode())
    sys.stdout.buffer.flush()

while True:
    msg = read_msg()
    if msg is None:
        break
    method = msg.get("method", "")
    rid = msg.get("id")
    _log.write(f"recv: {method} id={rid}\n"); _log.flush()
    if method == "initialize":
        write_msg({"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "test", "version": "0.1"}
        }})
    elif method == "tools/list":
        write_msg({"jsonrpc": "2.0", "id": rid, "result": {"tools": [
            {"name": "ping", "description": "Test", "inputSchema": {"type": "object", "properties": {}}}
        ]}})
    elif method == "tools/call":
        write_msg({"jsonrpc": "2.0", "id": rid, "result": {
            "content": [{"type": "text", "text": "pong"}]
        }})
    elif method == "ping":
        write_msg({"jsonrpc": "2.0", "id": rid, "result": {}})
