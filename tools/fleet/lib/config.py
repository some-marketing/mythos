"""
poc/config.py -- Configuration for worker and orchestrator.

Reads from environment variables with sensible defaults.
All configuration is centralized here.
"""

from __future__ import annotations

import os
import platform
import warnings
from dataclasses import dataclass


@dataclass
class WorkerConfig:
    """Worker daemon configuration."""
    worker_id: str = ""
    host: str = "0.0.0.0"
    port: int = 8001
    ollama_url: str = "http://localhost:11434"
    comfyui_url: str = "http://localhost:8188"
    orchestrator_url: str = "http://localhost:8000"
    advertise_url: str = ""
    max_concurrent_tasks: int = 2
    heartbeat_interval_seconds: int = 30

    @classmethod
    def from_env(cls) -> WorkerConfig:
        hostname = platform.node().split(".")[0].replace(" ", "-").lower()
        port = int(os.getenv("WORKER_PORT", "8001"))
        config = cls(
            worker_id=os.getenv("WORKER_ID", f"w_{hostname}"),
            host=os.getenv("WORKER_HOST", "0.0.0.0"),
            port=port,
            ollama_url=os.getenv("OLLAMA_URL", "http://localhost:11434"),
            comfyui_url=os.getenv("COMFYUI_URL", "http://localhost:8188"),
            orchestrator_url=os.getenv("ORCHESTRATOR_URL", "http://localhost:8000"),
            advertise_url=os.getenv(
                "WORKER_ADVERTISE_URL", f"http://{hostname}:{port}"
            ),
            max_concurrent_tasks=int(os.getenv("MAX_CONCURRENT_TASKS", "2")),
            heartbeat_interval_seconds=int(os.getenv("HEARTBEAT_INTERVAL", "30")),
        )
        return config


@dataclass
class OrchestratorConfig:
    """Orchestrator configuration."""
    host: str = "0.0.0.0"
    port: int = 8000
    claude_api_key: str = ""
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_catalog_enabled: bool = True
    openrouter_catalog_timeout_seconds: float = 5.0
    openrouter_catalog_limit: int = 12
    openrouter_catalog_refresh_interval_seconds: int = 900
    enable_cloud_nodes: bool = True
    cloud_node_max_concurrency: int = 8
    planner_model: str = "claude-sonnet-4-5-20250929"
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> OrchestratorConfig:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            warnings.warn(
                "ANTHROPIC_API_KEY not set. Planner and Synthesizer will fail.",
                stacklevel=2,
            )
        return cls(
            host=os.getenv("ORCHESTRATOR_HOST", "0.0.0.0"),
            port=int(os.getenv("ORCHESTRATOR_PORT", "8000")),
            claude_api_key=api_key,
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
            openrouter_base_url=os.getenv(
                "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
            ),
            openrouter_catalog_enabled=os.getenv(
                "OPENROUTER_CATALOG_ENABLED", "true"
            ).lower()
            in ("1", "true", "yes"),
            openrouter_catalog_timeout_seconds=float(
                os.getenv("OPENROUTER_CATALOG_TIMEOUT_SECONDS", "5.0")
            ),
            openrouter_catalog_limit=int(os.getenv("OPENROUTER_CATALOG_LIMIT", "12")),
            openrouter_catalog_refresh_interval_seconds=int(
                os.getenv("OPENROUTER_CATALOG_REFRESH_INTERVAL_SECONDS", "900")
            ),
            enable_cloud_nodes=os.getenv("ENABLE_CLOUD_NODES", "true").lower()
            in ("1", "true", "yes"),
            cloud_node_max_concurrency=int(
                os.getenv("CLOUD_NODE_MAX_CONCURRENCY", "8")
            ),
            planner_model=os.getenv("PLANNER_MODEL", "claude-sonnet-4-5-20250929"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )
