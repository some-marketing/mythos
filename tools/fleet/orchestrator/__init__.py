"""
poc/orchestrator/ -- SimpleMiniions Orchestrator.

Central brain: plans projects, selects models, dispatches tasks, synthesizes results.
"""

from tools.fleet.orchestrator.registry import NodeRegistry
from tools.fleet.orchestrator.selector import ModelSelector, classify_task
from tools.fleet.orchestrator.dispatcher import TaskDispatcher
from tools.fleet.orchestrator.cloud_node import CloudNodeManager, CloudNodeProxy
from tools.fleet.orchestrator.planner import Planner
from tools.fleet.orchestrator.synthesizer import ResultSynthesizer
from tools.fleet.orchestrator.workflow_engine import WorkflowEngine

__all__ = [
    "NodeRegistry",
    "ModelSelector",
    "classify_task",
    "TaskDispatcher",
    "CloudNodeManager",
    "CloudNodeProxy",
    "Planner",
    "ResultSynthesizer",
    "WorkflowEngine",
]
