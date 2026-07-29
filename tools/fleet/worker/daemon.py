"""
poc/worker/daemon.py -- Worker daemon HTTP server.

Each machine in the cluster runs one worker daemon. The daemon:
1. Discovers local Ollama models and hardware on startup
2. Sends periodic heartbeats to the orchestrator
3. Accepts task assignments via POST /api/tasks
4. Calls Ollama to execute tasks
5. Returns results to the orchestrator

Start with:
    python -m poc.worker.daemon
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import subprocess
import time
from ast import (
    Add,
    BinOp,
    Constant,
    Div,
    Expression,
    Mult,
    Pow,
    Sub,
    USub,
    UnaryOp,
    parse,
)
from contextlib import asynccontextmanager
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException

from tools.fleet.lib.config import WorkerConfig
from tools.fleet.lib.models import (
    HeartbeatRequest,
    ModelInfo,
    NodeStatus,
    Task,
    TaskResult,
    TaskStatus,
    TaskType,
    WorkerCapability,
)
from tools.fleet.worker.hardware import detect_hardware
from tools.fleet.worker.comfyui_client import ComfyUIClient
from tools.fleet.worker.ollama_client import OllamaClient

logger = logging.getLogger(__name__)


class WorkerDaemon:
    """Core worker logic, separate from FastAPI for testability."""

    def __init__(self, config: WorkerConfig) -> None:
        self.config = config
        self.ollama = OllamaClient(config.ollama_url)
        self.comfyui = ComfyUIClient(config.comfyui_url)
        self.hardware = detect_hardware()
        self.models: list[ModelInfo] = []
        self.current_tasks: int = 0
        self._heartbeat_task: asyncio.Task | None = None
        self._comfyui_available: bool = False

    async def startup(self) -> None:
        """Initialize: discover models, start heartbeat loop."""
        # Check Ollama is reachable
        healthy = await self.ollama.health_check()
        if not healthy:
            logger.warning("Ollama not reachable at %s", self.config.ollama_url)
        else:
            self.models = await self.ollama.list_models()
            logger.info(
                "Discovered %d models: %s",
                len(self.models),
                [m.model_id for m in self.models],
            )

        self._comfyui_available = await self.comfyui.health_check()
        if self._comfyui_available:
            logger.info("ComfyUI reachable at %s", self.config.comfyui_url)
        else:
            logger.warning("ComfyUI not reachable at %s", self.config.comfyui_url)

        # Start heartbeat loop
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info("Worker %s started on port %d", self.config.worker_id, self.config.port)

    async def shutdown(self) -> None:
        """Clean up on shutdown."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self.comfyui.close()
        await self.ollama.close()

    async def execute_task(self, task: Task) -> TaskResult:
        """Execute a single task using Ollama."""
        if self.current_tasks >= self.config.max_concurrent_tasks:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                error={"code": "WORKER_BUSY", "message": "Max concurrent tasks reached"},
            )

        self.current_tasks += 1
        try:
            if task.task_type == TaskType.LLM:
                return await self._execute_llm_task(task)
            elif task.task_type == TaskType.IMAGE_GEN:
                return await self._execute_image_gen_task(task)
            elif task.task_type == TaskType.TOOL_CALL:
                return await self._execute_tool_call_task(task)
            else:
                return TaskResult(
                    task_id=task.task_id,
                    status=TaskStatus.FAILED,
                    error={"code": "UNKNOWN_TASK_TYPE", "message": f"Unknown task type: {task.task_type}"},
                )
        finally:
            self.current_tasks -= 1

    async def _execute_llm_task(self, task: Task) -> TaskResult:
        """Execute an LLM task via Ollama."""
        try:
            result = await self.ollama.generate(
                model=task.model,
                prompt=task.prompt,
                system=task.system_prompt,
                temperature=task.parameters.temperature,
                max_tokens=task.parameters.max_tokens,
                timeout_seconds=task.timeout_seconds,
            )
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.COMPLETED,
                result=result,
                worker_id=self.config.worker_id,
                model_used=task.model,
                tokens_used=result.get("tokens_used", 0),
                latency_ms=result.get("latency_ms", 0),
            )
        except httpx.TimeoutException:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                error={"code": "TIMEOUT", "message": f"Task timed out after {task.timeout_seconds}s"},
                worker_id=self.config.worker_id,
            )
        except Exception as exc:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                error={"code": "EXECUTION_ERROR", "message": str(exc)},
                worker_id=self.config.worker_id,
            )

    async def _execute_image_gen_task(self, task: Task) -> TaskResult:
        """Execute an image generation task through ComfyUI."""
        if not self._comfyui_available:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.config.worker_id,
                error={
                    "code": "COMFYUI_UNAVAILABLE",
                    "message": f"ComfyUI unavailable at {self.config.comfyui_url}",
                },
            )

        start = time.perf_counter()
        try:
            params = task.metadata.get("image_params", {})
            result = await self.comfyui.generate_image(
                prompt=task.prompt,
                params=params,
                timeout_seconds=task.timeout_seconds,
            )
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.COMPLETED,
                result=result,
                worker_id=self.config.worker_id,
                model_used=task.model,
                latency_ms=int((time.perf_counter() - start) * 1000),
            )
        except TimeoutError:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.config.worker_id,
                model_used=task.model,
                latency_ms=int((time.perf_counter() - start) * 1000),
                error={
                    "code": "TIMEOUT",
                    "message": f"Image generation timed out after {task.timeout_seconds}s",
                },
            )
        except Exception as exc:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.config.worker_id,
                model_used=task.model,
                latency_ms=int((time.perf_counter() - start) * 1000),
                error={"code": "IMAGE_GEN_ERROR", "message": str(exc)},
            )

    async def _execute_tool_call_task(self, task: Task) -> TaskResult:
        """Execute a bounded built-in tool call."""
        tool_name = str(task.metadata.get("tool_name", "")).strip().lower()
        args = task.metadata.get("args", {})
        start = time.perf_counter()

        if not tool_name:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.config.worker_id,
                error={"code": "TOOL_NAME_REQUIRED", "message": "Missing metadata.tool_name"},
            )

        try:
            if tool_name == "echo":
                output = {"output": args.get("text", task.prompt)}
            elif tool_name == "sleep":
                seconds = float(args.get("seconds", 0))
                seconds = max(0.0, min(seconds, 10.0))
                await asyncio.sleep(seconds)
                output = {"output": f"slept {seconds:.2f}s"}
            elif tool_name == "calculate":
                expression = str(args.get("expression", task.prompt))
                output = {"output": self._safe_calculate(expression)}
            elif tool_name == "display":
                uri = str(args.get("uri", task.prompt)).strip()
                if not uri:
                    raise ValueError("uri is required for display tool")

                os_name = self.hardware.os.lower()
                if os_name == "windows":
                    os.startfile(uri)  # type: ignore[attr-defined]
                    output = {"output": f"triggered display on windows: {uri}", "pid": None}
                elif os_name == "darwin":
                    process = await asyncio.create_subprocess_exec("open", uri)
                    output = {"output": f"triggered display on mac: {uri}", "pid": process.pid}
                else:
                    try:
                        process = await asyncio.create_subprocess_exec("xdg-open", uri)
                        output = {"output": f"triggered display via xdg-open: {uri}", "pid": process.pid}
                    except Exception:
                        raise RuntimeError(f"Display tool not supported on OS: {self.hardware.os}")
            else:
                return TaskResult(
                    task_id=task.task_id,
                    status=TaskStatus.FAILED,
                    worker_id=self.config.worker_id,
                    error={
                        "code": "UNKNOWN_TOOL",
                        "message": f"Unsupported tool_name: {tool_name}",
                    },
                )

            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.COMPLETED,
                result={"tool_name": tool_name, **output},
                worker_id=self.config.worker_id,
                model_used=task.model,
                latency_ms=int((time.perf_counter() - start) * 1000),
            )
        except Exception as exc:
            return TaskResult(
                task_id=task.task_id,
                status=TaskStatus.FAILED,
                worker_id=self.config.worker_id,
                model_used=task.model,
                latency_ms=int((time.perf_counter() - start) * 1000),
                error={"code": "TOOL_EXECUTION_ERROR", "message": str(exc)},
            )

    def _safe_calculate(self, expression: str) -> float:
        """Evaluate arithmetic expressions with a strict AST whitelist."""
        node = parse(expression, mode="eval")

        allowed_bin_ops = (Add, Sub, Mult, Div, Pow)
        allowed_unary_ops = (USub,)

        def _eval(n):  # type: ignore[no-untyped-def]
            if isinstance(n, Expression):
                return _eval(n.body)
            if isinstance(n, Constant) and isinstance(n.value, (int, float)):
                return n.value
            if isinstance(n, BinOp) and isinstance(n.op, allowed_bin_ops):
                left = _eval(n.left)
                right = _eval(n.right)
                if isinstance(n.op, Add):
                    return left + right
                if isinstance(n.op, Sub):
                    return left - right
                if isinstance(n.op, Mult):
                    return left * right
                if isinstance(n.op, Div):
                    if right == 0:
                        raise ValueError("division by zero")
                    return left / right
                if isinstance(n.op, Pow):
                    return left ** right
            if isinstance(n, UnaryOp) and isinstance(n.op, allowed_unary_ops):
                return -_eval(n.operand)
            raise ValueError("unsupported expression")

        result = _eval(node)
        if not isinstance(result, (int, float)) or math.isinf(result) or math.isnan(result):
            raise ValueError("invalid numeric result")
        return float(result)

    def _get_git_info(self) -> tuple[str, str]:
        """Get current git branch and short commit hash."""
        try:
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"], 
                text=True, stderr=subprocess.DEVNULL
            ).strip()
            version = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], 
                text=True, stderr=subprocess.DEVNULL
            ).strip()
            return version, branch
        except Exception:
            return "unknown", "unknown"

    def _build_heartbeat(self) -> HeartbeatRequest:
        """Build heartbeat payload."""
        version, branch = self._get_git_info()
        return HeartbeatRequest(
            node_id=self.config.worker_id,
            hostname=self.config.worker_id,
            url=self.config.advertise_url,
            hardware=self.hardware,
            models=self.models,
            capabilities=WorkerCapability(
                llm=True,
                image_gen=self._comfyui_available,
                tool_call=True,
            ),
            current_tasks=self.current_tasks,
            max_concurrent_tasks=self.config.max_concurrent_tasks,
            status=NodeStatus.ONLINE,
            version=version,
            branch=branch,
        )

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to the orchestrator."""
        while True:
            try:
                hb = self._build_heartbeat()
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"{self.config.orchestrator_url}/api/heartbeat",
                        json=hb.model_dump(mode="json"),
                    )
                    if resp.status_code == 200:
                        logger.debug("Heartbeat sent to orchestrator")
                    else:
                        logger.warning("Heartbeat rejected: %s", resp.text)
            except httpx.ConnectError:
                logger.debug("Orchestrator not reachable (heartbeat skipped)")
            except Exception as exc:
                logger.warning("Heartbeat failed: %s", exc)

            await asyncio.sleep(self.config.heartbeat_interval_seconds)


# ======================================================================
# FastAPI Application
# ======================================================================

_worker: WorkerDaemon | None = None


def get_worker() -> WorkerDaemon:
    assert _worker is not None
    return _worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker
    config = WorkerConfig.from_env()
    _worker = WorkerDaemon(config)
    await _worker.startup()
    yield
    await _worker.shutdown()


app = FastAPI(title="SimpleMiniions Worker", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    w = get_worker()
    ollama_ok = await w.ollama.health_check()
    version, branch = w._get_git_info()
    return {
        "status": "healthy" if ollama_ok else "degraded",
        "worker_id": w.config.worker_id,
        "ollama": "ok" if ollama_ok else "unreachable",
        "models": len(w.models),
        "current_tasks": w.current_tasks,
        "version": version,
        "branch": branch,
    }


@app.get("/api/models")
async def list_models() -> dict[str, Any]:
    w = get_worker()
    return {"models": [m.model_dump() for m in w.models]}


@app.post("/api/tasks")
async def submit_task(task: Task) -> TaskResult:
    w = get_worker()
    return await w.execute_task(task)


def main():
    config = WorkerConfig.from_env()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(
        "tools.fleet.worker.daemon:app",
        host=config.host,
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
