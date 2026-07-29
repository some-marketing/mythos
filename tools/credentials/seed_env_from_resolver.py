#!/usr/bin/env python3
"""
seed_env_from_resolver.py — resolve a named set of secrets via the multi-provider
resolver and write them into an env file (default: <repo>/.env.local).

Provider chain comes from operator config (~/.Mythos/credentials.config.yaml) if
present, else from the default ordering in providers/registry.py.

Replaces the 1Password-only seed-google-ads-creds.sh. The new contract:

  python3 tools/credentials/seed_env_from_resolver.py \\
    --set google-ads

…where --set names a group declared in ~/.Mythos/credentials.config.yaml under
the `sets` key. Or pass --secrets KEY1 KEY2 ... to seed an ad-hoc list.

Secret values never appear in stdout/stderr. Only:
  - which secrets were resolved (by name)
  - which provider served each
  - which file the values landed in
"""

from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from tools.credentials.resolver import CredentialResolver, load_config


REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def main():
    parser = argparse.ArgumentParser(description="Seed env file via credential resolver")
    parser.add_argument("--set", help="Name of a set declared in credentials.config.yaml")
    parser.add_argument("--secrets", nargs="+", help="Ad-hoc list of secret names to resolve")
    parser.add_argument("--env-file", default=str(REPO_ROOT / ".env.local"), help="Target env file")
    parser.add_argument("--dry-run", action="store_true", help="Resolve but do not write")
    args = parser.parse_args()

    config = load_config()
    if args.set:
        sets = config.get("sets") or {}
        names = sets.get(args.set)
        if not names:
            sys.stderr.write(f"Set {args.set!r} not found in {Path.home() / '.Mythos' / 'credentials.config.yaml'}\n")
            sys.exit(2)
    elif args.secrets:
        names = args.secrets
    else:
        sys.stderr.write("Must provide --set NAME or --secrets KEY1 KEY2 ...\n")
        sys.exit(2)

    if not isinstance(names, list):
        sys.stderr.write(f"Set {args.set!r} must be a list of secret names\n")
        sys.exit(2)

    resolver = CredentialResolver()
    sys.stderr.write(f"Resolver provider order: {[p.name for p in resolver._order]}\n")
    sys.stderr.write(f"Available providers: {resolver.available_providers()}\n\n")

    resolved: dict[str, str] = {}
    misses: list[str] = []
    for name in names:
        result, trace = resolver.resolve(name)
        if result:
            sys.stderr.write(f"  {name}: HIT via {trace.served_by} ({trace.served_via})\n")
            resolved[name] = result.value
        else:
            sys.stderr.write(f"  {name}: MISS — tried {[a['provider'] for a in trace.attempts]}\n")
            misses.append(name)

    sys.stderr.write(f"\nResolved {len(resolved)} / {len(names)}; missed {len(misses)}\n")

    if args.dry_run:
        sys.stderr.write("[dry-run] not writing\n")
        return

    if not resolved:
        sys.stderr.write("Nothing to write.\n")
        return

    env_path = Path(args.env_file)
    env_path.parent.mkdir(parents=True, exist_ok=True)

    # Merge: strip existing lines for our keys, append new
    existing: list[str] = []
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line_stripped = line.strip()
            if not line_stripped or line_stripped.startswith("#"):
                existing.append(line)
                continue
            key = line_stripped.split("=", 1)[0].strip()
            if key in resolved:
                continue
            existing.append(line)
    for k, v in resolved.items():
        existing.append(f"{k}={v}")
    env_path.write_text("\n".join(existing) + "\n")
    try:
        env_path.chmod(0o600)
    except Exception:
        pass

    sys.stderr.write(f"\nWrote {len(resolved)} keys to {env_path} (chmod 0600)\n")
    if misses:
        sys.stderr.write(f"WARNING: {len(misses)} secrets not found — caller may need to add provider mappings to credentials.config.yaml or seed those entries.\n")


if __name__ == "__main__":
    main()
