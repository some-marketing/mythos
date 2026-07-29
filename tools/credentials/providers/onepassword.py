"""
1Password provider — uses the `op` CLI 2.x.
Requires: `op signin` completed by the operator.
"""

from __future__ import annotations
import json
import subprocess
from typing import Optional

from .base import CredentialProvider, ItemInfo, SecretResult


class OnePasswordProvider(CredentialProvider):
    name = "onepassword"
    display_name = "1Password (op CLI)"

    def is_available(self) -> bool:
        # 1. op binary present
        if subprocess.run(["which", "op"], capture_output=True).returncode != 0:
            return False
        # 2. some vault is reachable (proxy for "signed in")
        result = subprocess.run(["op", "vault", "list", "--format=json"], capture_output=True)
        if result.returncode != 0:
            return False
        try:
            vaults = json.loads(result.stdout)
            return isinstance(vaults, list) and len(vaults) > 0
        except json.JSONDecodeError:
            return False

    def list_items(self, filter_keyword: Optional[str] = None) -> list[ItemInfo]:
        # Enumerate items across all visible vaults
        out: list[ItemInfo] = []
        vault_raw = subprocess.run(["op", "vault", "list", "--format=json"], capture_output=True)
        if vault_raw.returncode != 0:
            return out
        try:
            vaults = json.loads(vault_raw.stdout)
        except json.JSONDecodeError:
            return out
        for v in vaults:
            vname = v.get("name")
            items_raw = subprocess.run(
                ["op", "item", "list", "--vault", vname, "--format=json"],
                capture_output=True,
            )
            if items_raw.returncode != 0:
                continue
            try:
                items = json.loads(items_raw.stdout)
            except json.JSONDecodeError:
                continue
            for i in items:
                title = i.get("title", "")
                if filter_keyword and filter_keyword.lower() not in title.lower():
                    continue
                out.append(ItemInfo(
                    provider=self.name,
                    id=title,  # op CLI accepts title as identifier when unique
                    title=title,
                    category=i.get("category"),
                    tags=i.get("tags") or [],
                    extra={"vault": vname, "uuid": i.get("id")},
                ))
        return out

    def get_secret(self, item_id: str, field_label: str) -> Optional[SecretResult]:
        # op item get accepts title OR uuid as item_id
        result = subprocess.run(
            ["op", "item", "get", item_id, "--reveal", "--format=json"],
            capture_output=True,
        )
        if result.returncode != 0:
            return None
        try:
            item = json.loads(result.stdout)
        except json.JSONDecodeError:
            return None
        # Find field by exact label match (case-insensitive)
        label_norm = field_label.strip().lower()
        for f in item.get("fields", []):
            label = (f.get("label") or f.get("id") or "").strip().lower()
            if label == label_norm and f.get("value"):
                return SecretResult(
                    provider=self.name,
                    item_id=item_id,
                    field_label=field_label,
                    value=f.get("value"),
                )
        # For SECURE_NOTE items, the body is in notesPlain — caller can request that label
        return None
