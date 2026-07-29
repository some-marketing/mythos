"""
Multi-provider credential resolver.

Resolves a logical credential request (e.g., "GOOGLE_ADS_DEVELOPER_TOKEN") across
the operator's configured provider chain. Returns the first hit, with a trace
of which providers were tried and which served the value.

Configuration: ~/.Mythos/credentials.config.yaml (optional)

  # Operator preference order. Providers not in this list still get tried, in
  # ALL_PROVIDERS order, after the listed ones.
  provider_order:
    - keychain
    - onepassword
    - env_file

  # Per-secret mappings — tell the resolver where to look for specific keys.
  # If a key isn't mapped here, the resolver searches each provider for an item
  # whose title matches the key.
  secrets:
    GOOGLE_ADS_DEVELOPER_TOKEN:
      keychain:    "GOOGLE_ADS_DEVELOPER_TOKEN"            # service name in keychain
      onepassword:
        item:  "mythos-google-ads-mcp"
        field: "Developer Token"
      env_file:    "GOOGLE_ADS_DEVELOPER_TOKEN"            # env var name

The resolver never logs secret values. Trace entries record provider name +
"hit"/"miss" only.
"""

from __future__ import annotations
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .providers.base import CredentialProvider, SecretResult
from .providers.registry import instantiate_all, ALL_PROVIDERS


CONFIG_PATH_JSON = Path.home() / ".Mythos" / "credentials.config.json"
CONFIG_PATH_YAML = Path.home() / ".Mythos" / "credentials.config.yaml"


@dataclass
class ResolveTrace:
    secret_name: str
    attempts: list[dict] = field(default_factory=list)
    served_by: Optional[str] = None
    served_via: Optional[str] = None  # "config_mapping" | "title_match"

    def attempt(self, provider: str, hit: bool, reason: str = "") -> None:
        self.attempts.append({"provider": provider, "hit": hit, "reason": reason})


def load_config() -> dict:
    # Prefer JSON (stdlib, zero deps). YAML is supported if PyYAML is installed.
    if CONFIG_PATH_JSON.exists():
        try:
            return json.loads(CONFIG_PATH_JSON.read_text())
        except json.JSONDecodeError:
            return {}
    if CONFIG_PATH_YAML.exists():
        try:
            import yaml  # type: ignore
            return yaml.safe_load(CONFIG_PATH_YAML.read_text()) or {}
        except ImportError:
            # Fall back to the simple parser; warn caller that YAML lists may not parse.
            return _parse_simple_yaml(CONFIG_PATH_YAML.read_text())
        except Exception:
            return {}
    return {}


def _parse_simple_yaml(text: str) -> dict:
    # Minimal YAML subset: top-level keys, nested dicts (2-space indent), lists of strings,
    # quoted/unquoted scalars. Good enough for our config schema.
    root: dict = {}
    stack: list[tuple[int, object]] = [(-1, root)]
    list_context: Optional[list] = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.lstrip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1] if stack else root
        if stripped.startswith("- "):
            value = stripped[2:].strip().strip('"').strip("'")
            if isinstance(parent, list):
                parent.append(value)
            continue
        if ":" in stripped:
            key, _, rest = stripped.partition(":")
            key = key.strip()
            rest = rest.strip()
            if rest == "" or rest is None:
                # Nested container — figure out if next line starts a list or dict
                container: object = {}  # default; promoted to list when "- " seen
                if isinstance(parent, dict):
                    parent[key] = container
                stack.append((indent, container))
                # heuristic: if next non-empty non-comment line at greater indent starts with "- ", convert to list
                # Defer that to runtime: we'll convert when we see a "- " child.
                continue
            value = rest.strip().strip('"').strip("'")
            if isinstance(parent, dict):
                parent[key] = value
    # Post-process: convert any dict whose only contents are list-like items… skip; our schema doesn't need this complexity.
    return root


class CredentialResolver:
    def __init__(self, providers: Optional[list[CredentialProvider]] = None, config: Optional[dict] = None):
        self.config = config if config is not None else load_config()
        self.providers = providers if providers is not None else instantiate_all()
        self._index = {p.name: p for p in self.providers}
        self._order = self._resolve_order()

    def _resolve_order(self) -> list[CredentialProvider]:
        preferred = self.config.get("provider_order") or []
        if isinstance(preferred, str):
            preferred = [preferred]
        ordered: list[CredentialProvider] = []
        seen: set[str] = set()
        for name in preferred:
            p = self._index.get(name)
            if p:
                ordered.append(p)
                seen.add(name)
        for p in self.providers:
            if p.name not in seen:
                ordered.append(p)
        return ordered

    def available_providers(self) -> list[str]:
        return [p.name for p in self._order if p.is_available()]

    def resolve(self, secret_name: str) -> tuple[Optional[SecretResult], ResolveTrace]:
        trace = ResolveTrace(secret_name=secret_name)
        secrets_map = (self.config.get("secrets") or {}).get(secret_name, {})

        for p in self._order:
            if not p.is_available():
                trace.attempt(p.name, hit=False, reason="not available")
                continue
            # Config-driven mapping if present
            mapping = secrets_map.get(p.name) if isinstance(secrets_map, dict) else None
            try:
                if mapping:
                    if isinstance(mapping, dict):
                        item_id = mapping.get("item", secret_name)
                        field_label = mapping.get("field", secret_name)
                    else:
                        item_id = mapping
                        field_label = secret_name
                    result = p.get_secret(item_id, field_label)
                    if result:
                        trace.served_by = p.name
                        trace.served_via = "config_mapping"
                        trace.attempt(p.name, hit=True, reason=f"config mapping → {item_id}/{field_label}")
                        return result, trace
                    trace.attempt(p.name, hit=False, reason=f"config mapping {item_id}/{field_label} returned nothing")
                else:
                    # Title-match fallback: try item_id == secret_name with default field
                    result = p.get_secret(secret_name, secret_name)
                    if result:
                        trace.served_by = p.name
                        trace.served_via = "title_match"
                        trace.attempt(p.name, hit=True, reason="title match")
                        return result, trace
                    trace.attempt(p.name, hit=False, reason="no title match")
            except Exception as e:
                trace.attempt(p.name, hit=False, reason=f"error: {str(e)[:120]}")
        return None, trace


def cli_main():
    """Resolve one or more secrets and print the trace (NEVER values)."""
    import sys
    if len(sys.argv) < 2:
        sys.stderr.write("usage: resolver.py SECRET_NAME [SECRET_NAME ...]\n")
        sys.exit(2)
    r = CredentialResolver()
    sys.stderr.write(f"Available providers (in order): {', '.join(r.available_providers())}\n")
    for name in sys.argv[1:]:
        result, trace = r.resolve(name)
        if result:
            sys.stderr.write(f"  {name}: HIT via {trace.served_by} ({trace.served_via})\n")
        else:
            sys.stderr.write(f"  {name}: MISS — tried {[a['provider'] for a in trace.attempts]}\n")


if __name__ == "__main__":
    cli_main()
