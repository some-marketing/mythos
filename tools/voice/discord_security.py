#!/usr/bin/env python3
"""
Discord Voice Callback Server - Security Module

Enforces security controls for Discord voice operations:
- Channel allowlists (guild, channel, user)
- Rate limiting
- Audit logging
"""

import json
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


class SecurityError(Exception):
    """Raised when a security check fails."""
    pass


class AuditEventType(Enum):
    """Types of security audit events."""
    JOIN_ATTEMPT = "join_attempt"
    JOIN_SUCCESS = "join_success"
    JOIN_DENIED = "join_denied"
    CALL_STARTED = "call_started"
    CALL_ENDED = "call_ended"
    RATE_LIMIT_HIT = "rate_limit_hit"
    USER_RECOGNIZED = "user_recognized"
    USER_DENIED = "user_denied"
    DISCONNECT = "disconnect"


@dataclass
class AuditEvent:
    """A single audit log entry."""
    timestamp: float
    event_type: AuditEventType
    guild_id: Optional[str]
    channel_id: Optional[str]
    user_id: Optional[str]
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.timestamp)
            ),
            "event_type": self.event_type.value,
            "guild_id": self._redact_id(self.guild_id),
            "channel_id": self._redact_id(self.channel_id),
            "user_id": self._redact_id(self.user_id),
            "details": self._redact_details(self.details),
        }

    @staticmethod
    def _redact_id(id_str: Optional[str]) -> Optional[str]:
        """Redact ID to last 4 chars for logging."""
        if not id_str:
            return None
        return f"***{id_str[-4:]}" if len(id_str) > 4 else "****"

    @staticmethod
    def _redact_details(details: dict) -> dict:
        """Redact sensitive fields from details."""
        redacted = {}
        for k, v in details.items():
            if any(s in k.lower() for s in ["token", "key", "secret", "password"]):
                redacted[k] = "***REDACTED***"
            else:
                redacted[k] = v
        return redacted


class DiscordSecurity:
    """
    Security controller for Discord voice callback server.

    Configured via environment variables:
    - DISCORD_GUILD_ID: Allowed guild ID (required)
    - DISCORD_VOICE_CHANNEL_ID: Target voice channel ID (required)
    - DISCORD_ALLOWED_USER_ID: Single allowed user ID (required)
    - DISCORD_CALL_COOLDOWN: Seconds between calls (default: 120)
    - DISCORD_INACTIVITY_TIMEOUT: Auto-disconnect timeout (default: 300)
    - DISCORD_AUDIT_LOG_PATH: Path to audit log file (optional)
    """

    def __init__(self):
        self.guild_id = os.environ.get("DISCORD_GUILD_ID", "")
        self.channel_id = os.environ.get("DISCORD_VOICE_CHANNEL_ID", "")
        self.allowed_user_id = os.environ.get("DISCORD_ALLOWED_USER_ID", "")
        self.cooldown_seconds = int(os.environ.get("DISCORD_CALL_COOLDOWN", "120"))
        self.inactivity_timeout = int(
            os.environ.get("DISCORD_INACTIVITY_TIMEOUT", "300")
        )

        self._audit_log_path = os.environ.get(
            "DISCORD_AUDIT_LOG_PATH",
            str(Path(__file__).parent / "logs" / "discord_voice_audit.jsonl"),
        )
        self._last_call_time: Optional[float] = None
        self._call_count = 0
        self._denied_count = 0

        # Ensure log directory exists
        Path(self._audit_log_path).parent.mkdir(parents=True, exist_ok=True)

    def _log_audit(self, event: AuditEvent) -> None:
        """Write audit event to log file."""
        try:
            with open(self._audit_log_path, "a") as f:
                f.write(json.dumps(event.to_dict()) + "\n")
        except Exception:
            pass  # Audit logging should never block operations

    def validate_configuration(self) -> None:
        """Validate that required config values are set."""
        missing = []
        if not self.guild_id:
            missing.append("DISCORD_GUILD_ID")
        if not self.channel_id:
            missing.append("DISCORD_VOICE_CHANNEL_ID")
        if not self.allowed_user_id:
            missing.append("DISCORD_ALLOWED_USER_ID")

        if missing:
            raise SecurityError(
                f"Missing required Discord security config: {', '.join(missing)}"
            )

    def check_rate_limit(self) -> tuple[bool, float]:
        """
        Check if call is within rate limits.

        Returns:
            (allowed, seconds_remaining)
        """
        now = time.monotonic()

        if self._last_call_time is None:
            return True, 0.0

        elapsed = now - self._last_call_time
        if elapsed >= self.cooldown_seconds:
            return True, 0.0

        remaining = self.cooldown_seconds - elapsed
        return False, remaining

    def record_call(self) -> None:
        """Record that a call was initiated."""
        self._last_call_time = time.monotonic()
        self._call_count += 1

    def check_guild_allowed(self, guild_id: str) -> bool:
        """Check if the guild is in the allowlist."""
        return guild_id == self.guild_id

    def check_channel_allowed(self, channel_id: str) -> bool:
        """Check if the voice channel is the configured target."""
        return channel_id == self.channel_id

    def check_user_allowed(self, user_id: str) -> bool:
        """Check if the user is the allowed user."""
        return user_id == self.allowed_user_id

    def audit_join_attempt(
        self,
        guild_id: Optional[str],
        channel_id: Optional[str],
        user_id: Optional[str],
        allowed: bool,
    ) -> None:
        """Log a voice channel join attempt."""
        event_type = AuditEventType.JOIN_SUCCESS if allowed else AuditEventType.JOIN_DENIED
        self._log_audit(
            AuditEvent(
                timestamp=time.time(),
                event_type=event_type,
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
                details={"allowed": allowed},
            )
        )

    def audit_call_started(self, summary: str) -> None:
        """Log that a voice call started."""
        self._log_audit(
            AuditEvent(
                timestamp=time.time(),
                event_type=AuditEventType.CALL_STARTED,
                guild_id=self.guild_id,
                channel_id=self.channel_id,
                user_id=self.allowed_user_id,
                details={
                    "summary_length": len(summary),
                    "call_number": self._call_count + 1,
                },
            )
        )

    def audit_call_ended(self, transcription: str, duration_seconds: float) -> None:
        """Log that a voice call ended."""
        self._log_audit(
            AuditEvent(
                timestamp=time.time(),
                event_type=AuditEventType.CALL_ENDED,
                guild_id=self.guild_id,
                channel_id=self.channel_id,
                user_id=self.allowed_user_id,
                details={
                    "transcription_length": len(transcription),
                    "duration_seconds": round(duration_seconds, 2),
                },
            )
        )

    def audit_rate_limit_hit(self) -> None:
        """Log a rate limit violation."""
        self._denied_count += 1
        self._log_audit(
            AuditEvent(
                timestamp=time.time(),
                event_type=AuditEventType.RATE_LIMIT_HIT,
                guild_id=self.guild_id,
                channel_id=self.channel_id,
                user_id=None,
                details={
                    "cooldown_seconds": self.cooldown_seconds,
                    "denied_count": self._denied_count,
                },
            )
        )

    def audit_disconnect(self, reason: str) -> None:
        """Log a disconnect event."""
        self._log_audit(
            AuditEvent(
                timestamp=time.time(),
                event_type=AuditEventType.DISCONNECT,
                guild_id=self.guild_id,
                channel_id=self.channel_id,
                user_id=None,
                details={"reason": reason},
            )
        )

    def get_stats(self) -> dict:
        """Get security statistics."""
        return {
            "call_count": self._call_count,
            "denied_count": self._denied_count,
            "last_call_ago": (
                time.monotonic() - self._last_call_time
                if self._last_call_time
                else None
            ),
            "cooldown_seconds": self.cooldown_seconds,
            "inactivity_timeout": self.inactivity_timeout,
        }
