"""
macOS Keychain provider — uses the `security` CLI.
Entries are addressed by service name (generic-password style).
"""

from __future__ import annotations
import re
import subprocess
from typing import Optional

from .base import CredentialProvider, ItemInfo, SecretResult


class KeychainProvider(CredentialProvider):
    name = "keychain"
    display_name = "macOS Keychain (security CLI)"

    def is_available(self) -> bool:
        # security is built-in on macOS; check for darwin
        import platform
        if platform.system() != "Darwin":
            return False
        return subprocess.run(["which", "security"], capture_output=True).returncode == 0

    def list_items(self, filter_keyword: Optional[str] = None) -> list[ItemInfo]:
        # dump-keychain emits 0x00000007 <blob>="<service-name>" lines.
        # NOTE: this enumeration may prompt the operator for keychain access; the
        # operator can grant or deny per their normal Keychain UX.
        try:
            raw = subprocess.check_output(["security", "dump-keychain"], stderr=subprocess.DEVNULL).decode("utf-8", "replace")
        except subprocess.CalledProcessError:
            return []
        names = sorted(set(re.findall(r'0x00000007 <blob>="([^"]+)"', raw)))
        out: list[ItemInfo] = []
        for n in names:
            if filter_keyword and filter_keyword.lower() not in n.lower():
                continue
            out.append(ItemInfo(
                provider=self.name,
                id=n,
                title=n,
                category="generic-password",
            ))
        return out

    def get_secret(self, item_id: str, field_label: str = "password") -> Optional[SecretResult]:
        # Keychain generic-password entries have one value per service name.
        # field_label is ignored for keychain (it's always the "password" field).
        result = subprocess.run(
            ["security", "find-generic-password", "-s", item_id, "-w"],
            capture_output=True,
        )
        if result.returncode != 0:
            return None
        value = result.stdout.decode("utf-8", "replace").rstrip("\n")
        if not value:
            return None
        return SecretResult(
            provider=self.name,
            item_id=item_id,
            field_label=field_label,
            value=value,
        )

    def supports_write(self) -> bool:
        return True

    def write_item(self, title: str, fields: dict[str, str], tags=None) -> None:
        # Keychain only has one secret per service; we write the field named
        # "password" (default) or whatever the caller provided.
        # If multiple fields given, we write each as a separate service named
        # f"{title}__{label}".
        for label, value in fields.items():
            service = title if label.lower() in ("password", "secret", "value") else f"{title}__{label}"
            subprocess.run(
                ["security", "add-generic-password", "-s", service, "-a", "Mythos", "-w", value, "-U"],
                check=True,
            )
