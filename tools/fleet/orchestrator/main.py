"""
poc/orchestrator/main.py -- The Orchestrator.

Central brain of SimpleMiniions. Plans projects using Claude (or workflow
templates), selects optimal models via Model Selector, dispatches tasks
to worker nodes, and synthesizes results.

Start with:
    python -m poc.orchestrator.main
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from tools.fleet.lib.config import OrchestratorConfig
from tools.fleet.lib.models import (
    HeartbeatRequest,
    HeartbeatResponse,
    PlanStep,
    Project,
    ProjectConstraints,
    ProjectPlan,
    ProjectStatus,
    Task,
    TaskParameters,
    TaskResult,
    TaskStatus,
)
from tools.fleet.orchestrator.dispatcher import TaskDispatcher
from tools.fleet.orchestrator.cloud_node import CloudNodeManager
from tools.fleet.orchestrator.planner import Planner
from tools.fleet.orchestrator.registry import NodeRegistry
from tools.fleet.orchestrator.selector import ModelSelector, classify_task
from tools.fleet.orchestrator.synthesizer import ResultSynthesizer
from tools.fleet.orchestrator.workflow_engine import WorkflowEngine

logger = logging.getLogger(__name__)


class Orchestrator:
    """The central orchestration engine."""

    def __init__(self, config: OrchestratorConfig) -> None:
        self.config = config
        self.registry = NodeRegistry()
        self.cloud_nodes = CloudNodeManager.from_config(config)
        self.selector = ModelSelector(nodes_fn=self.registry.get_online_nodes)
        self.dispatcher = TaskDispatcher(
            registry_fn=lambda nid: getattr(self.registry.get_node(nid), "url", None),
            cloud_executor=self.cloud_nodes.execute,
        )
        self.planner = Planner(
            api_key=config.claude_api_key,
            model=config.planner_model,
        )
        self.synthesizer = ResultSynthesizer(
            api_key=config.claude_api_key,
            model=config.planner_model,
        )
        workflow_dir = Path(__file__).resolve().parents[1] / "workflows"
        self.workflow_engine = WorkflowEngine(template_dir=str(workflow_dir))

        # In-memory project store (Phase 2: PostgreSQL)
        self._projects: dict[str, Project] = {}
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._cloud_catalog_refresh_task: asyncio.Task | None = None

        # Register cloud virtual nodes so selector can route to them.
        self.cloud_nodes.register_in_registry(self.registry)

    async def start_background_tasks(self) -> None:
        """Start orchestrator background loops."""
        if not (
            self.config.enable_cloud_nodes
            and self.config.openrouter_catalog_enabled
            and self.config.openrouter_api_key
            and self.config.openrouter_catalog_refresh_interval_seconds > 0
        ):
            return
        if self._cloud_catalog_refresh_task is None:
            self._cloud_catalog_refresh_task = asyncio.create_task(
                self._cloud_catalog_refresh_loop()
            )

    async def shutdown(self) -> None:
        """Stop background loops."""
        if self._cloud_catalog_refresh_task:
            self._cloud_catalog_refresh_task.cancel()
            try:
                await self._cloud_catalog_refresh_task
            except asyncio.CancelledError:
                pass
            self._cloud_catalog_refresh_task = None

    async def _cloud_catalog_refresh_loop(self) -> None:
        """Periodically refresh OpenRouter model metadata and re-register nodes."""
        interval = max(10, int(self.config.openrouter_catalog_refresh_interval_seconds))
        while True:
            try:
                await asyncio.sleep(interval)
                changed = await asyncio.to_thread(
                    self.cloud_nodes.refresh_from_config, self.config
                )
                if changed:
                    self.cloud_nodes.register_in_registry(self.registry)
                    logger.info("Refreshed OpenRouter catalog and updated cloud node metadata")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Cloud catalog refresh failed: %s", exc)

    async def submit_project(
        self,
        name: str,
        description: str,
        workflow_template: Optional[str] = None,
        parameters: Optional[dict[str, Any]] = None,
        constraints: Optional[ProjectConstraints] = None,
    ) -> Project:
        """Submit a new project for execution."""
        project = Project(
            name=name,
            description=description,
            workflow_template=workflow_template,
            parameters=parameters or {},
            constraints=constraints or ProjectConstraints(),
        )
        self._projects[project.project_id] = project

        # Execute in background
        asyncio.create_task(self._execute_project(project))
        return project

    async def get_project(self, project_id: str) -> Optional[Project]:
        return self._projects.get(project_id)

    async def list_projects(self) -> list[Project]:
        return list(self._projects.values())

    async def _execute_project(self, project: Project) -> None:
        """Execute a project: plan -> dispatch steps -> synthesize."""
        try:
            # Phase 1: Planning
            project.status = ProjectStatus.PLANNING
            project.updated_at = datetime.utcnow()

            await self._emit(project.project_id, "planning_started", {})

            if project.workflow_template:
                # Template-driven: fast, free, deterministic
                template = self.workflow_engine.load_template(project.workflow_template)
                errors = self.workflow_engine.validate_parameters(template, project.parameters)
                if errors:
                    raise ValueError(f"Template parameter errors: {errors}")
                plan = self.workflow_engine.to_project_plan(
                    template=template,
                    project_id=project.project_id,
                    parameters=project.parameters,
                )
            else:
                # Claude-driven: flexible, costs money, creative
                plan = await self.planner.create_plan(
                    project_name=project.name,
                    project_description=project.description,
                    available_models=self._get_available_model_ids(),
                    constraints=project.constraints,
                    parameters=project.parameters,
                )

            plan.project_id = project.project_id
            project.plan = plan
            project.updated_at = datetime.utcnow()

            await self._emit(project.project_id, "plan_created", {
                "steps": len(plan.steps),
                "planning_model": plan.planning_model,
            })

            # Phase 2: Execution
            project.status = ProjectStatus.EXECUTING
            project.updated_at = datetime.utcnow()

            step_results: dict[int, TaskResult] = {}
            ordered_steps = self._topological_order(plan.steps)

            for step in ordered_steps:
                await self._emit(project.project_id, "step_started", {
                    "step_index": step.step_index,
                    "description": step.description,
                })

                # Build prompt with context from prior steps
                prompt = self._build_step_prompt(step, step_results, project)

                # Select best model + node
                selection = self.selector.select(
                    task_description=step.description,
                    task_category=self._infer_category(step),
                    constraints=project.constraints,
                    required_model=step.recommended_model,
                )

                if selection is None:
                    logger.error("No model available for step %d", step.step_index)
                    result = TaskResult(
                        task_id=f"t_{project.project_id}_{step.step_index}",
                        status=TaskStatus.FAILED,
                        error={"code": "NO_MODEL", "message": "No model available"},
                    )
                else:
                    task = Task(
                        task_id=f"t_{project.project_id}_{step.step_index}",
                        task_type=step.task_type,
                        model=selection.model_id,
                        prompt=prompt,
                        parameters=TaskParameters(
                            temperature=0.7,
                            max_tokens=min(step.estimated_tokens * 2, 4096),
                        ),
                        timeout_seconds=120,
                    )
                    result = await self.dispatcher.dispatch(task, selection)

                step_results[step.step_index] = result
                project.results.append(result)

                if result.cost_usd:
                    project.cost_total_usd += result.cost_usd

                await self._emit(project.project_id, "step_completed", {
                    "step_index": step.step_index,
                    "status": result.status.value,
                    "model_used": result.model_used,
                    "latency_ms": result.latency_ms,
                    "cost_usd": result.cost_usd,
                })

                project.updated_at = datetime.utcnow()

            # Phase 3: Synthesis
            project.status = ProjectStatus.SYNTHESIZING
            project.updated_at = datetime.utcnow()

            final_output = await self.synthesizer.synthesize(
                project_name=project.name,
                project_description=project.description,
                step_results=step_results,
                plan=plan,
            )
            project.final_output = final_output
            project.status = ProjectStatus.COMPLETED
            project.updated_at = datetime.utcnow()

            await self._emit(project.project_id, "project_completed", {
                "project_id": project.project_id,
                "total_cost_usd": project.cost_total_usd,
            })

        except Exception as exc:
            logger.exception("Project %s failed", project.project_id)
            project.status = ProjectStatus.FAILED
            project.updated_at = datetime.utcnow()
            await self._emit(project.project_id, "project_failed", {
                "error": str(exc),
            })

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _topological_order(self, steps: list[PlanStep]) -> list[PlanStep]:
        """Sort steps respecting dependency order."""
        completed: set[int] = set()
        remaining = list(steps)
        ordered: list[PlanStep] = []

        while remaining:
            progress = False
            for step in list(remaining):
                if all(d in completed for d in step.depends_on):
                    ordered.append(step)
                    completed.add(step.step_index)
                    remaining.remove(step)
                    progress = True
            if not progress:
                logger.warning("Circular dependency detected, appending remaining steps")
                ordered.extend(remaining)
                break

        return ordered

    def _build_step_prompt(
        self,
        step: PlanStep,
        prior_results: dict[int, TaskResult],
        project: Project,
    ) -> str:
        """Build the prompt for a step, injecting prior step results."""
        context_parts: list[str] = []

        for dep_idx in step.depends_on:
            dep_result = prior_results.get(dep_idx)
            if dep_result and dep_result.result:
                text = dep_result.result.get("text", "")
                context_parts.append(f"[Result from step {dep_idx}]:\n{text}")

        context = "\n\n".join(context_parts) if context_parts else ""

        prompt = step.prompt_template or step.description
        prompt = prompt.replace("{{context}}", context)
        prompt = prompt.replace("{{project_name}}", project.name)
        prompt = prompt.replace("{{project_description}}", project.description)
        for key, value in project.parameters.items():
            prompt = prompt.replace("{{" + key + "}}", str(value))

        if context and "{{context}}" not in (step.prompt_template or ""):
            prompt = f"Context from prior steps:\n{context}\n\nTask: {prompt}"

        return prompt

    def _infer_category(self, step: PlanStep) -> str:
        """Infer task category from step description."""
        return classify_task(step.description)

    def _get_available_model_ids(self) -> list[str]:
        """Get list of all model IDs across all online nodes."""
        models: set[str] = set()
        for node in self.registry.get_online_nodes():
            for m in node.models:
                models.add(m.model_id)
        return sorted(models)

    # ------------------------------------------------------------------
    # SSE Streaming
    # ------------------------------------------------------------------

    async def _emit(self, project_id: str, event: str, data: dict) -> None:
        msg = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        queues = self._subscribers.get(project_id, [])
        for q in queues:
            await q.put(msg)

    def subscribe(self, project_id: str) -> asyncio.Queue:
        if project_id not in self._subscribers:
            self._subscribers[project_id] = []
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers[project_id].append(q)
        return q

    def unsubscribe(self, project_id: str, queue: asyncio.Queue) -> None:
        queues = self._subscribers.get(project_id, [])
        if queue in queues:
            queues.remove(queue)


# ======================================================================
# FastAPI Application
# ======================================================================

_orchestrator: Orchestrator | None = None


def get_orchestrator() -> Orchestrator:
    assert _orchestrator is not None
    return _orchestrator


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator
    config = OrchestratorConfig.from_env()
    _orchestrator = Orchestrator(config)
    await _orchestrator.start_background_tasks()
    logger.info("Orchestrator started on port %d", config.port)
    yield
    await _orchestrator.shutdown()
    logger.info("Orchestrator shutting down")


app = FastAPI(title="SimpleMiniions Orchestrator", lifespan=lifespan)


@app.post("/api/projects")
async def create_project(body: dict[str, Any]) -> dict[str, Any]:
    orch = get_orchestrator()
    constraints = None
    if "constraints" in body:
        constraints = ProjectConstraints.model_validate(body["constraints"])
    project = await orch.submit_project(
        name=body["name"],
        description=body["description"],
        workflow_template=body.get("workflow_template"),
        parameters=body.get("parameters", {}),
        constraints=constraints,
    )
    return {
        "project_id": project.project_id,
        "status": project.status.value,
        "stream_url": f"/api/stream/{project.project_id}",
        "created_at": project.created_at.isoformat(),
    }


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    orch = get_orchestrator()
    project = await orch.get_project(project_id)
    if not project:
        raise HTTPException(404, f"Project {project_id} not found")
    return project.model_dump(mode="json")


@app.get("/api/projects")
async def list_projects() -> dict[str, Any]:
    orch = get_orchestrator()
    projects = await orch.list_projects()
    return {
        "projects": [
            {
                "project_id": p.project_id,
                "name": p.name,
                "status": p.status.value,
                "cost_total_usd": p.cost_total_usd,
                "created_at": p.created_at.isoformat(),
            }
            for p in projects
        ]
    }


@app.get("/api/nodes")
async def list_nodes() -> dict[str, Any]:
    orch = get_orchestrator()
    nodes = orch.registry.get_all_nodes()
    return {"nodes": [n.model_dump(mode="json") for n in nodes]}


@app.post("/api/heartbeat")
async def heartbeat(hb: HeartbeatRequest) -> HeartbeatResponse:
    orch = get_orchestrator()
    orch.registry.register_or_update(hb)
    return HeartbeatResponse()


@app.get("/api/stream/{project_id}")
async def stream_project(project_id: str) -> StreamingResponse:
    orch = get_orchestrator()
    project = await orch.get_project(project_id)
    if not project:
        raise HTTPException(404, f"Project {project_id} not found")

    queue = orch.subscribe(project_id)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                msg = await asyncio.wait_for(queue.get(), timeout=300.0)
                yield msg
                if "project_completed" in msg or "project_failed" in msg:
                    break
        except asyncio.TimeoutError:
            yield "event: timeout\ndata: {}\n\n"
        finally:
            orch.unsubscribe(project_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def main():
    config = OrchestratorConfig.from_env()
    logging.basicConfig(level=getattr(logging, config.log_level))
    uvicorn.run(
        "tools.fleet.orchestrator.main:app",
        host=config.host,
        port=config.port,
        log_level=config.log_level.lower(),
    )


if __name__ == "__main__":
    main()
