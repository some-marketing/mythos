"""
Env-file provider — reads/writes .env-style files.
Useful as a last-resort cache or for CI environments where vaults aren't available.
"""

from __future__ import annotations
from pathlib import Path
from typing import Optional

from .base import CredentialProvider, ItemInfo, SecretResult


class EnvFileProvider(CredentialProvider):
    name = "env_file"
    display_name = "Env file (.env-style)"

    def __init__(self, paths: Optional[list[Path]] = None):
        if paths is None:
            paths = [
                Path(".env.local"),
                Path(".env"),
                Path.home() / ".Mythos" / ".env",
            ]
        self.paths = [p for p in paths if p.exists()]

    def is_available(self) -> bool:
        return len(self.paths) > 0

    def list_items(self, filter_keyword: Optional[str] = None) -> list[ItemInfo]:
        out: list[ItemInfo] = []
        for p in self.paths:
            try:
                for line in p.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    idx = line.find("=")
                    if idx <= 0:
                        continue
                    key = line[:idx].strip()
                    if filter_keyword and filter_keyword.lower() not in key.lower():
                        continue
                    out.append(ItemInfo(
                        provider=self.name,
                        id=f"{p}::{key}",
                        title=key,
                        category="env_var",
                        extra={"file": str(p), "key": key},
                    ))
            except Exception:
                continue
        return out

    def get_secret(self, item_id: str, field_label: str = "value") -> Optional[SecretResult]:
        # item_id format is "<file_path>::<KEY>" OR just "<KEY>" (search all files)
        if "::" in item_id:
            file_str, key = item_id.split("::", 1)
            files = [Path(file_str)]
        else:
            key = item_id
            files = self.paths
        for p in files:
            if not p.exists():
                continue
            try:
                for line in p.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if not line.startswith(key + "="):
                        continue
                    value = line[len(key) + 1:]
                    # Strip optional quoting
                    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    return SecretResult(
                        provider=self.name,
                        item_id=item_id,
                        field_label=field_label,
                        value=value,
                    )
            except Exception:
                continue
        return None

    def supports_write(self) -> bool:
        return True

    def write_item(self, title: str, fields: dict[str, str], tags=None) -> None:
        # Write to the first writable path (defaults to .env.local in cwd)
        target = self.paths[0] if self.paths else Path(".env.local")
        # Merge: strip existing lines for our keys, append new
        existing = []
        if target.exists():
            for line in target.read_text().splitlines():
                line_stripped = line.strip()
                if not line_stripped or line_stripped.startswith("#"):
                    existing.append(line)
                    continue
                key = line_stripped.split("=", 1)[0].strip()
                if key in fields:
                    continue
                existing.append(line)
        for k, v in fields.items():
            existing.append(f"{k}={v}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(existing) + "\n")
        try:
            target.chmod(0o600)
        except Exception:
            pass
