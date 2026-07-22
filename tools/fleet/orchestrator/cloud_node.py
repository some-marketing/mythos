"""
poc/orchestrator/cloud_node.py -- Cloud provider virtual nodes.

Cloud providers are wrapped behind the same Task -> TaskResult interface as workers.
They can be registered as `cloud://...` nodes in the registry.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from tools.fleet.lib.config import OrchestratorConfig
from tools.fleet.lib.models import (
    HardwareInfo,
    HeartbeatRequest,
    ModelInfo,
    NodeStatus,
    Task,
    TaskResult,
    TaskStatus,
    WorkerCapability,
)


def _cloud_hardware(name: str) -> HardwareInfo:
    return HardwareInfo(
        cpu_cores=0,
        ram_total_gb=0.0,
        ram_available_gb=0.0,
        os=f"cloud:{name}",
        arch="virtual",
    )


def _cloud_model_profile(provider: str, model_id: str) -> dict[str, Any]:
    """
    Return heuristic quality + cost metadata for cloud model scoring.

    Costs are intentionally approximate planning values used for routing
    tradeoffs, not billing-grade accounting.
    """
    key = model_id.lower()

    if provider == "openrouter":
        if "gpt-4o-mini" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0010,
                "quality_scores": {"general": 0.82, "reasoning": 0.80, "coding": 0.80, "writing": 0.82},
            }
        if "deepseek" in key and "r1" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0015,
                "quality_scores": {"general": 0.84, "reasoning": 0.90, "coding": 0.85, "writing": 0.78},
            }
        if "gemini-3.1-pro" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0035,
                "quality_scores": {"general": 0.94, "reasoning": 0.96, "coding": 0.92, "writing": 0.94},
            }
        if "gemini-3.1-flash" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0005,
                "quality_scores": {"general": 0.88, "reasoning": 0.85, "coding": 0.82, "writing": 0.88},
            }
        if "gemma-4" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0002,
                "quality_scores": {"general": 0.86, "reasoning": 0.88, "coding": 0.84, "writing": 0.82},
            }
        if "claude" in key and "sonnet" in key:
            return {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": 0.0050,
                "quality_scores": {"general": 0.91, "reasoning": 0.92, "coding": 0.90, "writing": 0.91},
            }

    if provider == "anthropic":
        if "sonnet" in key:
            return {
                "provider": "anthropic",
                "estimated_cost_per_1k_tokens_usd": 0.0060,
                "quality_scores": {"general": 0.92, "reasoning": 0.93, "coding": 0.90, "writing": 0.92},
            }

    # Generic cloud fallback.
    return {
        "provider": provider,
        "estimated_cost_per_1k_tokens_usd": 0.0040,
        "quality_scores": {"general": 0.80, "reasoning": 0.80, "coding": 0.80, "writing": 0.80},
    }


@dataclass
class CloudNodeProxy:
    """Execute tasks for a specific cloud provider."""

    node_id: str
    provider: str
    base_url: str
    api_key: str
    models: list[str]
    model_profiles: dict[str, dict[str, Any]] = field(default_factory=dict)
    max_concurrent_tasks: int = 8

    def _estimate_cost_usd(self, model_id: str, total_tokens: int) -> float:
        profile = self._resolve_model_profile(model_id)
        per_1k = float(profile["estimated_cost_per_1k_tokens_usd"])
        return round((max(total_tokens, 0) / 1000.0) * per_1k, 6)

    def _resolve_model_profile(self, model_id: str) -> dict[str, Any]:
        base = _cloud_model_profile(self.provider, model_id)
        override = self.model_profiles.get(model_id)
        if not override:
            return base

        merged = dict(base)
        merged.update(override)
        merged_quality = dict(base.get("quality_scores", {}))
        merged_quality.update(dict(override.get("quality_scores", {})))
        merged["quality_scores"] = merged_quality
        return merged

    def to_heartbeat(self) -> HeartbeatRequest:
        model_infos: list[ModelInfo] = []
        for model_id in self.models:
            profile = self._resolve_model_profile(model_id)
            model_infos.append(
                ModelInfo(
                    model_id=model_id,
                    name=model_id,
                    provider=str(profile["provider"]),
                    context_length=int(profile.get("context_length", 4096)),
                    estimated_cost_per_1k_tokens_usd=float(
                        profile["estimated_cost_per_1k_tokens_usd"]
                    ),
                    capabilities=list(profile.get("capabilities", ["chat", "reasoning", "code", "writing"])),
                    quality_scores=dict(profile["quality_scores"]),
                )
            )
        return HeartbeatRequest(
            node_id=self.node_id,
            hostname=self.node_id,
            url=f"cloud://{self.provider}",
            hardware=_cloud_hardware(self.provider),
            models=model_infos,
            capabilities=WorkerCapability(llm=True, image_gen=False, tool_call=False),
            current_tasks=0,
            max_concurrent_tasks=self.max_concurrent_tasks,
            status=NodeStatus.ONLINE,
        )

    async def execute_task(self, task: Task) -> TaskResult:
        start = time.perf_counter()
        try:
            if self.provider == "anthropic":
                text, tokens = await self._call_anthropic(task)
            elif self.provider == "openrouter":
                text, tokens = await self._call_openrouter(task)
            else:
                raise ValueError(f"Unsupported cloud provider: {self.provider}")

            elapsed_ms = int((time.perf_counter() - start) * 1000)
            estimated_cost = self._estimate_cost_usd(task.model, tokens)
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.COMPLETED,
                result={"text": text, "provider": self.provider},
                worker_id=self.node_id,
                model_used=task.model,
                tokens_used=tokens,
                latency_ms=elapsed_ms,
                cost_usd=estimated_cost,
            )
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.node_id,
                model_used=task.model,
                latency_ms=elapsed_ms,
                error={"code": "CLOUD_EXECUTION_ERROR", "message": str(exc)},
            )

    async def _call_anthropic(self, task: Task) -> tuple[str, int]:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": task.model,
            "max_tokens": task.parameters.max_tokens,
            "messages": [{"role": "user", "content": task.prompt}],
        }
        if task.system_prompt:
            payload["system"] = task.system_prompt

        async with httpx.AsyncClient(timeout=float(task.timeout_seconds)) as client:
            resp = await client.post(f"{self.base_url}/v1/messages", headers=headers, json=payload)
            maybe_result = resp.raise_for_status()
            if hasattr(maybe_result, "__await__"):
                await maybe_result
            data = resp.json()

        text = data["content"][0]["text"]
        usage = data.get("usage", {})
        tokens = int(usage.get("output_tokens", 0)) + int(usage.get("input_tokens", 0))
        return text, tokens

    async def _call_openrouter(self, task: Task) -> tuple[str, int]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        messages = []
        if task.system_prompt:
            messages.append({"role": "system", "content": task.system_prompt})
        messages.append({"role": "user", "content": task.prompt})

        payload = {
            "model": task.model,
            "messages": messages,
            "temperature": task.parameters.temperature,
            "max_tokens": task.parameters.max_tokens,
            "top_p": task.parameters.top_p,
        }

        async with httpx.AsyncClient(timeout=float(task.timeout_seconds)) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions", headers=headers, json=payload
            )
            maybe_result = resp.raise_for_status()
            if hasattr(maybe_result, "__await__"):
                await maybe_result
            data = resp.json()

        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        tokens = int(usage.get("total_tokens", 0))
        return text, tokens


class CloudNodeManager:
    """Registry and executor for cloud provider proxies."""

    def __init__(self, proxies: list[CloudNodeProxy]) -> None:
        self._proxies = {proxy.node_id: proxy for proxy in proxies}

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @classmethod
    def _normalize_cost_per_1k(cls, price_value: Any) -> float:
        raw = cls._safe_float(price_value, 0.0)
        if raw <= 0:
            return 0.0
        # OpenRouter pricing fields are often USD/token; convert to USD/1k tokens.
        if raw < 0.001:
            return raw * 1000.0
        return raw

    @classmethod
    def _infer_capabilities(cls, model_id: str, item: dict[str, Any]) -> list[str]:
        caps = {"chat"}

        architecture = item.get("architecture") or {}
        modalities: list[str] = []
        for key in ("modality", "input_modalities", "output_modalities"):
            value = architecture.get(key)
            if isinstance(value, str):
                modalities.append(value.lower())
            elif isinstance(value, list):
                modalities.extend(str(v).lower() for v in value)

        if any("image" in m for m in modalities):
            caps.add("image")
        if any("audio" in m for m in modalities):
            caps.add("audio")
        if any("video" in m for m in modalities):
            caps.add("video")

        mid = model_id.lower()
        if any(token in mid for token in ("code", "coder", "devstral", "programming")):
            caps.add("code")
        if any(token in mid for token in ("reason", "r1", "o1", "o3", "sonnet", "claude")):
            caps.add("reasoning")
        if any(token in mid for token in ("gpt", "llama", "qwen", "mistral", "claude")):
            caps.add("writing")

        return sorted(caps)

    @classmethod
    def _parse_openrouter_catalog(
        cls,
        payload: dict[str, Any],
        max_models: int = 12,
    ) -> tuple[list[str], dict[str, dict[str, Any]]]:
        items = payload.get("data")
        if not isinstance(items, list):
            return [], {}

        candidates: list[dict[str, Any]] = []
        profiles: dict[str, dict[str, Any]] = {}

        for item in items:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not isinstance(model_id, str) or not model_id.strip():
                continue

            pricing = item.get("pricing") or {}
            prompt_price = cls._normalize_cost_per_1k(pricing.get("prompt"))
            completion_price = cls._normalize_cost_per_1k(pricing.get("completion"))
            est_per_1k = prompt_price + completion_price
            if est_per_1k <= 0:
                est_per_1k = 0.0040

            base = _cloud_model_profile("openrouter", model_id)
            caps = cls._infer_capabilities(model_id, item)
            context_len = int(item.get("context_length") or 4096)

            profiles[model_id] = {
                "provider": "openrouter",
                "estimated_cost_per_1k_tokens_usd": round(est_per_1k, 6),
                "quality_scores": dict(base.get("quality_scores", {})),
                "capabilities": caps,
                "context_length": context_len,
            }

            # Prefer affordable models with broad text capability.
            affordability = profiles[model_id]["estimated_cost_per_1k_tokens_usd"]
            candidates.append(
                {
                    "model_id": model_id,
                    "cost": affordability,
                    "caps": caps,
                }
            )

        # Keep text/chat-capable models.
        candidates = [
            c for c in candidates if "chat" in c["caps"] or "writing" in c["caps"]
        ]
        candidates.sort(key=lambda c: (c["cost"], c["model_id"]))

        preferred_order = [
            "openai/gpt-4o-mini",
            "deepseek/deepseek-r1",
            "anthropic/claude-3.5-sonnet",
        ]

        selected: list[str] = []
        for pid in preferred_order:
            if pid in profiles and pid not in selected:
                selected.append(pid)

        for candidate in candidates:
            mid = candidate["model_id"]
            if mid in selected:
                continue
            selected.append(mid)
            if len(selected) >= max_models:
                break

        if not selected:
            return [], {}

        selected_profiles = {mid: profiles[mid] for mid in selected if mid in profiles}
        return selected, selected_profiles

    @classmethod
    def _fetch_openrouter_model_profiles(
        cls,
        api_key: str,
        base_url: str,
        timeout_seconds: float,
        max_models: int,
    ) -> tuple[list[str], dict[str, dict[str, Any]]]:
        if not api_key or "test" in api_key.lower():
            return [], {}

        url = f"{base_url.rstrip('/')}/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            resp = httpx.get(url, headers=headers, timeout=timeout_seconds)
            resp.raise_for_status()
            payload = resp.json()
            if not isinstance(payload, dict):
                return [], {}
            return cls._parse_openrouter_catalog(payload, max_models=max_models)
        except Exception:
            return [], {}

    @classmethod
    def from_config(cls, config: OrchestratorConfig) -> CloudNodeManager:
        proxies: list[CloudNodeProxy] = []

        if config.enable_cloud_nodes and config.claude_api_key:
            proxies.append(
                CloudNodeProxy(
                    node_id="cloud-anthropic",
                    provider="anthropic",
                    base_url="https://api.anthropic.com",
                    api_key=config.claude_api_key,
                    models=[
                        config.planner_model,
                        "claude-3-5-sonnet-latest",
                    ],
                    max_concurrent_tasks=config.cloud_node_max_concurrency,
                )
            )

        if config.enable_cloud_nodes and config.openrouter_api_key:
            dynamic_models: list[str] = []
            dynamic_profiles: dict[str, dict[str, Any]] = {}
            if config.openrouter_catalog_enabled:
                dynamic_models, dynamic_profiles = cls._fetch_openrouter_model_profiles(
                    api_key=config.openrouter_api_key,
                    base_url=config.openrouter_base_url,
                    timeout_seconds=config.openrouter_catalog_timeout_seconds,
                    max_models=config.openrouter_catalog_limit,
                )

            fallback_models = [
                "openai/gpt-4o-mini",
                "anthropic/claude-3.5-sonnet",
                "deepseek/deepseek-r1",
            ]
            proxies.append(
                CloudNodeProxy(
                    node_id="cloud-openrouter",
                    provider="openrouter",
                    base_url=config.openrouter_base_url.rstrip("/"),
                    api_key=config.openrouter_api_key,
                    models=dynamic_models or fallback_models,
                    model_profiles=dynamic_profiles,
                    max_concurrent_tasks=config.cloud_node_max_concurrency,
                )
            )

        return cls(proxies)

    def register_in_registry(self, registry: Any) -> None:
        for proxy in self._proxies.values():
            registry.register_or_update(proxy.to_heartbeat())

    def refresh_from_config(self, config: OrchestratorConfig) -> bool:
        """
        Refresh dynamic cloud model metadata from providers.

        Returns True when the effective cloud model catalog changed.
        """
        if not (
            config.enable_cloud_nodes
            and config.openrouter_catalog_enabled
            and config.openrouter_api_key
        ):
            return False

        models, profiles = self._fetch_openrouter_model_profiles(
            api_key=config.openrouter_api_key,
            base_url=config.openrouter_base_url,
            timeout_seconds=config.openrouter_catalog_timeout_seconds,
            max_models=config.openrouter_catalog_limit,
        )
        if not models:
            return False

        node_id = "cloud-openrouter"
        proxy = self._proxies.get(node_id)
        if proxy is None:
            self._proxies[node_id] = CloudNodeProxy(
                node_id=node_id,
                provider="openrouter",
                base_url=config.openrouter_base_url.rstrip("/"),
                api_key=config.openrouter_api_key,
                models=models,
                model_profiles=profiles,
                max_concurrent_tasks=config.cloud_node_max_concurrency,
            )
            return True

        changed = False
        base_url = config.openrouter_base_url.rstrip("/")
        if proxy.base_url != base_url:
            proxy.base_url = base_url
            changed = True
        if proxy.max_concurrent_tasks != config.cloud_node_max_concurrency:
            proxy.max_concurrent_tasks = config.cloud_node_max_concurrency
            changed = True
        if proxy.models != models:
            proxy.models = models
            changed = True
        if proxy.model_profiles != profiles:
            proxy.model_profiles = profiles
            changed = True

        return changed

    async def execute(self, node_id: str, task: Task) -> TaskResult | None:
        proxy = self._proxies.get(node_id)
        if not proxy:
            return None
        return await proxy.execute_task(task)
