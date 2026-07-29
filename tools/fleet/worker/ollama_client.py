"""
poc/worker/ollama_client.py -- HTTP client for Ollama REST API.

Handles model discovery, inference, and health checks.
Communicates with a local or remote Ollama instance.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

from tools.fleet.lib.models import ModelInfo

logger = logging.getLogger(__name__)


class OllamaClient:
    """Client for Ollama HTTP API."""

    def __init__(self, base_url: str = "http://localhost:11434") -> None:
        self.base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url, timeout=120.0
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def health_check(self) -> bool:
        """Check if Ollama is reachable."""
        try:
            client = await self._get_client()
            resp = await client.get("/", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[ModelInfo]:
        """List all models available in Ollama."""
        try:
            client = await self._get_client()
            resp = await client.get("/api/tags")
            resp.raise_for_status()
            data = resp.json()

            models: list[ModelInfo] = []
            for m in data.get("models", []):
                name = m.get("name", "")
                details = m.get("details", {})
                size_bytes = m.get("size", 0)

                models.append(ModelInfo(
                    model_id=name,
                    name=name,
                    parameter_count=details.get("parameter_size", ""),
                    quantization=details.get("quantization_level", ""),
                    context_length=_infer_context_length(name),
                    size_gb=round(size_bytes / (1024**3), 2),
                ))
            return models
        except Exception as exc:
            logger.error("Failed to list Ollama models: %s", exc)
            return []

    async def generate(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        timeout_seconds: int = 120,
    ) -> dict[str, Any]:
        """Generate text using Ollama API. Returns result dict."""
        start = time.monotonic()

        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if system:
            payload["system"] = system

        client = await self._get_client()
        resp = await client.post(
            "/api/generate",
            json=payload,
            timeout=float(timeout_seconds),
        )
        resp.raise_for_status()
        data = resp.json()

        latency_ms = int((time.monotonic() - start) * 1000)
        tokens = data.get("eval_count", 0) + data.get("prompt_eval_count", 0)

        return {
            "text": data.get("response", ""),
            "model": model,
            "tokens_used": tokens,
            "latency_ms": latency_ms,
            "eval_count": data.get("eval_count", 0),
            "prompt_eval_count": data.get("prompt_eval_count", 0),
        }


def _infer_context_length(model_name: str) -> int:
    """Infer context length from model name. Conservative defaults."""
    name_lower = model_name.lower()
    if "128k" in name_lower:
        return 131072
    if "32k" in name_lower:
        return 32768
    if "llama" in name_lower or "mistral" in name_lower:
        return 8192
    if "deepseek" in name_lower:
        return 16384
    return 4096
