"""
poc/worker -- Worker daemon components.

The worker daemon runs on each machine in the cluster and:
- Detects local hardware and models
- Sends heartbeats to the orchestrator
- Accepts and executes tasks
"""

from tools.fleet.worker.daemon import WorkerDaemon, app
from tools.fleet.worker.comfyui_client import ComfyUIClient
from tools.fleet.worker.hardware import detect_hardware
from tools.fleet.worker.ollama_client import OllamaClient

__all__ = [
    "WorkerDaemon",
    "app",
    "ComfyUIClient",
    "detect_hardware",
    "OllamaClient",
]
