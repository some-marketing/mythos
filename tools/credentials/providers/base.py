"""
Provider interface for credential resolution.

Every concrete provider implements `is_available`, `list_items`, and `get_secret`.
The interface is minimal — the resolver only needs to enumerate items and fetch
named fields. No vendor-specific concepts leak into callers.

Add a new provider by subclassing CredentialProvider and registering in registry.py.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ItemInfo:
    """One credential entry visible to a provider."""
    provider: str           # provider name (e.g., "onepassword")
    id: str                 # provider-specific identifier (title, name, etc.)
    title: str              # human-readable display name
    category: Optional[str] = None  # provider-specific (LOGIN, SECURE_NOTE, etc.)
    tags: list[str] = field(default_factory=list)
    fields: list[str] = field(default_factory=list)  # known field labels (no values)
    extra: dict = field(default_factory=dict)        # provider-specific metadata


@dataclass
class SecretResult:
    """A resolved secret value. Always opaque to logs/transcripts."""
    provider: str
    item_id: str
    field_label: str
    value: str  # treat as sensitive — never log, never serialize to artifacts

    def __repr__(self) -> str:
        return f"SecretResult(provider={self.provider!r}, item_id={self.item_id!r}, field={self.field_label!r}, value=<redacted len={len(self.value)}>)"


class CredentialProvider(ABC):
    """Base class for credential providers."""

    name: str = "base"
    display_name: str = "Base Provider"

    @abstractmethod
    def is_available(self) -> bool:
        """True if this provider's tooling is installed AND the operator is authenticated."""
        ...

    @abstractmethod
    def list_items(self, filter_keyword: Optional[str] = None) -> list[ItemInfo]:
        """Enumerate credential-shaped items. Filter is a substring match on titles."""
        ...

    @abstractmethod
    def get_secret(self, item_id: str, field_label: str) -> Optional[SecretResult]:
        """Fetch a single field from a single item. Returns None if not found."""
        ...

    def supports_write(self) -> bool:
        """Override if the provider can create/update entries."""
        return False

    def write_item(self, title: str, fields: dict[str, str], tags: Optional[list[str]] = None) -> None:
        raise NotImplementedError(f"{self.name} does not support write")
