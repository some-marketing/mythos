"""
poc/orchestrator/dispatcher.py -- Task dispatcher.

Dispatches tasks to worker nodes with retry and fallback.
Supports virtual cloud nodes through an injected cloud executor.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable, Optional

import httpx

from tools.fleet.lib.models import ModelSelection, Task, TaskResult, TaskStatus

logger = logging.getLogger(__name__)

MAX_RETRIES_PER_NODE = 2


CloudExecutor = Callable[[str, Task], Awaitable[TaskResult | None]]


class TaskDispatcher:
    """Dispatch tasks to worker nodes with retry and fallback."""

    def __init__(
        self,
        registry_fn: Callable[[str], Optional[str]] | None = None,
        cloud_executor: CloudExecutor | None = None,
    ) -> None:
        self._get_node_url = registry_fn
        self._cloud_executor = cloud_executor

    async def dispatch(
        self,
        task: Task,
        selection: ModelSelection,
        max_retries: int = MAX_RETRIES_PER_NODE,
    ) -> TaskResult:
        """Dispatch task to primary, then fallbacks."""
        # Primary cloud node path
        if selection.node_url.startswith("cloud://") and self._cloud_executor:
            cloud_result = await self._cloud_executor(selection.node_id, task)
            if cloud_result is not None:
                return cloud_result

        # Primary local node path
        result = await self._try_node(
            task=task,
            node_url=selection.node_url,
            node_id=selection.node_id,
            retries=max_retries,
        )
        if result and result.status == TaskStatus.COMPLETED:
            return result

        # Fallbacks
        for fallback in selection.fallbacks:
            fb_node_id = fallback["node_id"]
            fb_model_id = fallback["model_id"]
            fb_url = fallback.get("node_url") or self._resolve_node_url(fb_node_id)

            fb_task = task.model_copy(update={"model": fb_model_id})

            if fb_url and fb_url.startswith("cloud://") and self._cloud_executor:
                cloud_result = await self._cloud_executor(fb_node_id, fb_task)
                if cloud_result and cloud_result.status == TaskStatus.COMPLETED:
                    return cloud_result
                continue

            if not fb_url:
                continue

            logger.info(
                "Falling back to %s on %s for task %s",
                fb_model_id,
                fb_node_id,
                task.task_id,
            )
            result = await self._try_node(
                task=fb_task,
                node_url=fb_url,
                node_id=fb_node_id,
                retries=1,
            )
            if result and result.status == TaskStatus.COMPLETED:
                return result

        logger.error("All dispatch attempts failed for task %s", task.task_id)
        return TaskResult(
            task_id=task.task_id,
            status=TaskStatus.FAILED,
            error={
                "code": "ALL_NODES_FAILED",
                "message": "Task failed on all available nodes",
            },
        )

    async def _try_node(
        self,
        task: Task,
        node_url: str,
        node_id: str,
        retries: int,
    ) -> Optional[TaskResult]:
        for attempt in range(retries):
            try:
                async with httpx.AsyncClient(timeout=float(task.timeout_seconds + 10)) as client:
                    resp = await client.post(
                        f"{node_url}/api/tasks",
                        json=task.model_dump(mode="json"),
                    )
                    maybe_result = resp.raise_for_status()
                    if hasattr(maybe_result, "__await__"):
                        await maybe_result
                    payload = resp.json()
                    if hasattr(payload, "__await__"):
                        payload = await payload
                    return TaskResult.model_validate(payload)
            except (httpx.TimeoutException, TimeoutError):
                logger.warning(
                    "Timeout dispatching to %s (attempt %d/%d)",
                    node_id,
                    attempt + 1,
                    retries,
                )
            except httpx.ConnectError:
                logger.warning(
                    "Cannot connect to %s (attempt %d/%d)",
                    node_id,
                    attempt + 1,
                    retries,
                )
                break
            except Exception as exc:
                logger.warning(
                    "Dispatch to %s failed (attempt %d/%d): %s",
                    node_id,
                    attempt + 1,
                    retries,
                    exc,
                )

        return None

    def _resolve_node_url(self, node_id: str) -> Optional[str]:
        if self._get_node_url:
            return self._get_node_url(node_id)
        return None
