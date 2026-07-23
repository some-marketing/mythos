#!/usr/bin/env python3
"""
audit_credentials.py — read-only audit of credential surfaces.

Surveys:
  1. 1Password items (across visible vaults) — titles/categories only
  2. .env.local, .env, ~/.Mythos/.env — KEY NAMES only, no values
  3. macOS keychain — service names only (filtered to credential-shaped)
  4. Repo references to credential env-var names + 1Password item titles

Writes JSON + markdown report to _dev/reports/credentials/<stamp>__audit.{json,md}.

NEVER captures credential values.
"""

from __future__ import annotations
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "_dev" / "reports" / "credentials"
STAMP = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")

CREDIT_SHAPED_KEYWORDS = [
    "api", "token", "secret", "key", "oauth", "credential",
    "password", "auth", "sa-", "mcp", "client", "developer",
    "ads", "refresh",
]

REPO_REF_PATTERNS = [
    r"GOOGLE_ADS_[A-Z_]+",
    r"OP_SERVICE_ACCOUNT_TOKEN",
    r"OP_CONNECT_[A-Z_]+",
    r"SMOS_DART_TOKEN",
    r"MYTHOS_DART_TOKEN",
    r"DISCORD_BOT_TOKEN",
    r"AGENTIC_?FLOW_[A-Z_]+",
    r"NOTION_[A-Z_]+",
    r"CANVA_[A-Z_]+",
    r"META_ADS_[A-Z_]+",
    r"FB_[A-Z_]+_TOKEN",
    r"MICROSOFT_ADS_[A-Z_]+",
    r"mythos-google-ads-mcp",
    r"mythos-meta-ads-mcp",
    r"{CLIENT_CODE}-metaads",
    r"Service Account Auth Token",
    r"Sam.s Memories",
]


def is_credit_shaped(s: str) -> bool:
    s = s.lower()
    return any(k in s for k in CREDIT_SHAPED_KEYWORDS)


def run_quiet(cmd: list[str]) -> str:
    try:
        return subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return ""
    except FileNotFoundError:
        return ""


def section_onepassword() -> dict:
    if not run_quiet(["which", "op"]).strip():
        return {"available": False, "reason": "op CLI not installed"}
    raw = run_quiet(["op", "vault", "list", "--format=json"])
    if not raw:
        return {"available": False, "reason": "op CLI not signed in or no vaults"}
    try:
        vaults = json.loads(raw)
    except json.JSONDecodeError:
        return {"available": False, "reason": "vault list JSON parse failed"}
    out = {"available": True, "vaults": []}
    for v in vaults:
        vname = v.get("name")
        items_raw = run_quiet(["op", "item", "list", "--vault", vname, "--format=json"])
        try:
            items = json.loads(items_raw) if items_raw else []
        except json.JSONDecodeError:
            items = []
        catalog = []
        for i in items:
            title = i.get("title", "")
            cat = i.get("category", "")
            catalog.append({
                "title": title,
                "category": cat,
                "credit_shaped": is_credit_shaped(title),
            })
        out["vaults"].append({"name": vname, "item_count": len(items), "items": catalog})
    return out


def section_env_files() -> dict:
    out = {}
    candidates = [
        REPO_ROOT / ".env.local",
        REPO_ROOT / ".env",
        Path.home() / ".Mythos" / ".env",
    ]
    for path in candidates:
        if not path.exists():
            out[str(path)] = None
            continue
        keys: list[str] = []
        try:
            for line in path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                idx = line.find("=")
                if idx > 0:
                    keys.append(line[:idx].strip())
        except Exception as e:
            out[str(path)] = {"error": str(e)}
            continue
        out[str(path)] = sorted(set(keys))
    return out


def section_keychain() -> dict:
    raw = run_quiet(["security", "dump-keychain"])
    if not raw:
        return {"available": False, "reason": "security dump-keychain failed or empty"}
    # Service names live in the 0x00000007 attribute; format:
    #   0x00000007 <blob>="<name>"
    pattern = re.compile(r'0x00000007 <blob>="([^"]+)"')
    names = sorted(set(pattern.findall(raw)))
    credit_shaped = [n for n in names if is_credit_shaped(n)]
    return {
        "available": True,
        "total_service_names": len(names),
        "credit_shaped_entries": credit_shaped,
    }


def section_repo_references() -> dict:
    combined = "|".join(REPO_REF_PATTERNS)
    cmd = [
        "grep", "-rEn",
        "--include=*.sh", "--include=*.js", "--include=*.cjs",
        "--include=*.mjs", "--include=*.ts", "--include=*.json",
        "--include=*.yaml", "--include=*.yml", "--include=*.md",
        "--include=*.py",
        combined,
        str(REPO_ROOT / "tools"),
        str(REPO_ROOT / "frameworks"),
        str(REPO_ROOT / "instructions"),
        str(REPO_ROOT / ".claude"),
    ]
    raw = run_quiet(cmd)
    by_file: dict = {}
    hit_count = 0
    pattern_res = [re.compile(p) for p in REPO_REF_PATTERNS]
    for line in raw.splitlines():
        if not line:
            continue
        parts = line.split(":", 2)
        if len(parts) < 3:
            continue
        fpath, lineno, content = parts
        rel = fpath.replace(str(REPO_ROOT) + "/", "")
        matched = sorted({m.group(0) for p in pattern_res for m in p.finditer(line)})
        if not matched:
            continue
        try:
            lineno_int = int(lineno)
        except ValueError:
            continue
        by_file.setdefault(rel, []).append({"line": lineno_int, "matched": matched})
        hit_count += 1
    return {"hit_count": hit_count, "by_file": by_file}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    report = {
        "captured_at_utc": STAMP,
        "tool": "tools/credentials/audit_credentials.py",
        "scope": "1Password + env files + keychain + repo references (READ-ONLY, no values)",
        "onepassword": section_onepassword(),
        "env_files": section_env_files(),
        "keychain": section_keychain(),
        "repo_references": section_repo_references(),
    }

    json_path = OUT_DIR / f"{STAMP}__audit.json"
    md_path = OUT_DIR / f"{STAMP}__audit.md"

    json_path.write_text(json.dumps(report, indent=2))

    md = [f"# Credential Audit — {STAMP}", ""]
    md.append("Read-only audit. Credential values are never recorded.")
    md.append("")

    op = report["onepassword"]
    if op.get("available"):
        md.append(f"## 1Password ({len(op['vaults'])} vaults visible)")
        for v in op["vaults"]:
            credy = [i for i in v["items"] if i["credit_shaped"]]
            md.append(f"- **{v['name']}** — {v['item_count']} items, {len(credy)} credential-shaped")
            for i in credy:
                md.append(f"  - `{i['title']}` _({i['category']})_")
    else:
        md.append("## 1Password — UNAVAILABLE")
        md.append(f"Reason: {op.get('reason')}")
    md.append("")

    md.append("## Env files (KEY NAMES only)")
    for path, keys in report["env_files"].items():
        if keys is None:
            md.append(f"- `{path}` — not present")
        elif isinstance(keys, dict) and "error" in keys:
            md.append(f"- `{path}` — error: {keys['error']}")
        else:
            md.append(f"- `{path}` — {len(keys)} keys")
            for k in keys:
                md.append(f"  - `{k}`")
    md.append("")

    kc = report["keychain"]
    if kc.get("available"):
        md.append(f"## Keychain — {kc.get('total_service_names', 0)} services total, {len(kc.get('credit_shaped_entries', []))} credential-shaped")
        for n in kc.get("credit_shaped_entries", []):
            md.append(f"- `{n}`")
    else:
        md.append("## Keychain — UNAVAILABLE")
        md.append(f"Reason: {kc.get('reason')}")
    md.append("")

    rr = report["repo_references"]
    md.append(f"## Repo references — {rr['hit_count']} hits across {len(rr['by_file'])} files")
    for fpath in sorted(rr["by_file"].keys()):
        hits = rr["by_file"][fpath]
        md.append(f"- `{fpath}` — {len(hits)} hit(s)")
        for h in hits[:6]:
            md.append(f"  - line {h['line']}: {', '.join(h['matched'])}")
        if len(hits) > 6:
            md.append(f"  - ... and {len(hits)-6} more")
    md.append("")

    md_path.write_text("\n".join(md))

    print(str(json_path))
    print(str(md_path), file=sys.stderr)


if __name__ == "__main__":
    main()
