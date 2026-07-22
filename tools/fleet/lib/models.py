"""
poc/models.py -- Shared data models for SimpleMiniions distributed orchestrator.

All Pydantic v2 models used by both worker daemons and the orchestrator.
This is the single source of truth for all data types in the system.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ======================================================================
# Enums
# ======================================================================

class NodeStatus(str, Enum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"


class TaskStatus(str, Enum):
    PENDING = "pending"
    DISPATCHED = "dispatched"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskType(str, Enum):
    """Types of tasks that can be executed."""
    LLM = "llm"
    IMAGE_GEN = "image_gen"
    TOOL_CALL = "tool_call"  # Includes: echo, sleep, calculate, display


class ProjectStatus(str, Enum):
    PENDING = "pending"
    PLANNING = "planning"
    EXECUTING = "executing"
    SYNTHESIZING = "synthesizing"
    COMPLETED = "completed"
    FAILED = "failed"


# ======================================================================
# Hardware Models
# ======================================================================

class GpuInfo(BaseModel):
    """GPU hardware information."""
    name: str
    vram_gb: float
    driver: str = ""
    cuda_version: str = ""
    metal_support: bool = False


class HardwareInfo(BaseModel):
    """Machine hardware capabilities."""
    cpu_cores: int
    ram_total_gb: float
    ram_available_gb: float
    gpu: Optional[GpuInfo] = None
    os: str = ""
    arch: str = ""


# ======================================================================
# Model Info
# ======================================================================

class ModelInfo(BaseModel):
    """Information about a single model available on a node."""
    model_id: str                           # e.g. "mistral-nemo:12b"
    name: str = ""                          # human-readable name
    provider: str = "local"                 # local|openrouter|anthropic|...
    parameter_count: Optional[str] = None   # e.g. "12B"
    quantization: Optional[str] = None      # e.g. "Q4_K_M"
    context_length: int = 4096
    size_gb: float = 0.0
    estimated_cost_per_1k_tokens_usd: float = 0.0
    capabilities: list[str] = Field(default_factory=list)  # ["chat", "code"]
    quality_scores: dict[str, float] = Field(default_factory=dict)


# ======================================================================
# Worker Capability
# ======================================================================

class WorkerCapability(BaseModel):
    """What a worker node can do."""
    llm: bool = True
    image_gen: bool = False
    tool_call: bool = False


# ======================================================================
# Node Info
# ======================================================================

class NodeInfo(BaseModel):
    """Complete information about a worker node."""
    node_id: str
    hostname: str
    url: str                                # e.g. "http://192.168.1.100:8001"
    status: NodeStatus = NodeStatus.ONLINE
    hardware: HardwareInfo
    models: list[ModelInfo] = Field(default_factory=list)
    capabilities: WorkerCapability = Field(default_factory=WorkerCapability)
    current_tasks: int = 0
    max_concurrent_tasks: int = 2
    last_heartbeat: Optional[datetime] = None
    version: str = "unknown"
    branch: str = "unknown"


# ======================================================================
# Heartbeat Protocol
# ======================================================================

class HeartbeatRequest(BaseModel):
    """Sent by worker to orchestrator every N seconds."""
    node_id: str
    hostname: str
    url: str
    hardware: HardwareInfo
    models: list[ModelInfo] = Field(default_factory=list)
    capabilities: WorkerCapability = Field(default_factory=WorkerCapability)
    current_tasks: int = 0
    max_concurrent_tasks: int = 2
    status: NodeStatus = NodeStatus.ONLINE
    version: str = "unknown"
    branch: str = "unknown"


class HeartbeatResponse(BaseModel):
    """Orchestrator reply to heartbeat."""
    ok: bool = True
    message: str = "registered"


# ======================================================================
# Task Models
# ======================================================================

class TaskParameters(BaseModel):
    """LLM generation parameters."""
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.9
    stop: list[str] = Field(default_factory=list)


class Task(BaseModel):
    """A single unit of work dispatched to a worker."""
    task_id: str = Field(default_factory=lambda: f"t_{uuid.uuid4().hex[:12]}")
    task_type: TaskType = TaskType.LLM
    model: str                              # model_id to use
    prompt: str
    system_prompt: Optional[str] = None
    parameters: TaskParameters = Field(default_factory=TaskParameters)
    timeout_seconds: int = 120
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskError(BaseModel):
    """Structured error from a failed task."""
    code: str                               # e.g. "MODEL_NOT_AVAILABLE"
    message: str
    retryable: bool = False


class TaskResult(BaseModel):
    """Result of executing a task."""
    task_id: str
    status: TaskStatus
    result: Optional[dict[str, Any]] = None
    error: Optional[dict[str, str]] = None
    worker_id: Optional[str] = None
    model_used: Optional[str] = None
    tokens_used: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0


# ======================================================================
# Model Selection
# ======================================================================

class ModelSelection(BaseModel):
    """Result of model selector: which model on which node."""
    model_id: str
    node_id: str
    node_url: str
    score: float = 0.0
    explanation: str = ""
    fallbacks: list[dict[str, str]] = Field(default_factory=list)


# ======================================================================
# Project / Plan Models
# ======================================================================

class ProjectConstraints(BaseModel):
    """Constraints for project execution."""
    prefer_local: bool = True
    max_cost_usd: Optional[float] = None
    deadline_minutes: Optional[int] = None
    required_capabilities: list[str] = Field(default_factory=list)


class PlanStep(BaseModel):
    """One step in a project plan."""
    step_index: int
    description: str
    task_type: TaskType = TaskType.LLM
    recommended_model: Optional[str] = None
    prompt_template: str = ""
    depends_on: list[int] = Field(default_factory=list)
    estimated_tokens: int = 500
    estimated_cost_usd: float = 0.0


class ProjectPlan(BaseModel):
    """A plan created by the Planner for executing a project."""
    project_id: str = ""
    steps: list[PlanStep] = Field(default_factory=list)
    total_estimated_cost_usd: float = 0.0
    total_estimated_time_seconds: int = 0
    planning_model: str = ""


class Project(BaseModel):
    """A project submitted by the operator."""
    project_id: str = Field(default_factory=lambda: f"p_{uuid.uuid4().hex[:8]}")
    name: str
    description: str
    workflow_template: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    constraints: ProjectConstraints = Field(default_factory=ProjectConstraints)
    status: ProjectStatus = ProjectStatus.PENDING
    plan: Optional[ProjectPlan] = None
    results: list[TaskResult] = Field(default_factory=list)
    final_output: Optional[str] = None
    cost_total_usd: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ======================================================================
# Workflow Template Models
# ======================================================================

class WorkflowStepTemplate(BaseModel):
    """One step in a workflow template."""
    name: str
    task_type: TaskType = TaskType.LLM
    prompt_template: str = ""
    model_preference: Optional[str] = None
    depends_on: list[str] = Field(default_factory=list)  # step names
    parameters: TaskParameters = Field(default_factory=TaskParameters)


class WorkflowTemplate(BaseModel):
    """A reusable workflow template loaded from YAML."""
    name: str
    description: str = ""
    version: str = "1.0"
    required_parameters: list[str] = Field(default_factory=list)
    steps: list[WorkflowStepTemplate] = Field(default_factory=list)
