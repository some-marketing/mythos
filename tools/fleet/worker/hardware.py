"""
poc/worker/hardware.py -- Hardware detection for worker nodes.

Detects CPU cores, RAM, GPU (NVIDIA CUDA or Apple Metal),
and returns a HardwareInfo model.
"""

from __future__ import annotations

import platform
import subprocess
import logging

import psutil

from tools.fleet.lib.models import GpuInfo, HardwareInfo

logger = logging.getLogger(__name__)


def detect_hardware() -> HardwareInfo:
    """Detect hardware capabilities of the current machine."""
    gpu = detect_gpu()
    return HardwareInfo(
        cpu_cores=psutil.cpu_count(logical=False) or 1,
        ram_total_gb=round(psutil.virtual_memory().total / (1024**3), 1),
        ram_available_gb=round(psutil.virtual_memory().available / (1024**3), 1),
        gpu=gpu,
        os=platform.system().lower(),
        arch=platform.machine(),
    )


def detect_gpu() -> GpuInfo | None:
    """Detect GPU: tries NVIDIA first, then Apple Metal."""
    gpu = _detect_nvidia()
    if gpu:
        return gpu
    gpu = _detect_apple_metal()
    if gpu:
        return gpu
    return None


def _detect_nvidia() -> GpuInfo | None:
    """Detect NVIDIA GPU using nvidia-smi."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None

        line = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            return None

        name = parts[0]
        vram_mb = float(parts[1])
        driver = parts[2]

        # Detect CUDA version
        cuda_version = ""
        cuda_result = subprocess.run(
            ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if cuda_result.returncode == 0:
            cuda_version = cuda_result.stdout.strip()

        return GpuInfo(
            name=name,
            vram_gb=round(vram_mb / 1024, 1),
            driver=driver,
            cuda_version=cuda_version,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    except Exception as exc:
        logger.debug("NVIDIA detection failed: %s", exc)
        return None


def _detect_apple_metal() -> GpuInfo | None:
    """Detect Apple Silicon GPU (Metal support)."""
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return None

    try:
        result = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        cpu_name = result.stdout.strip() if result.returncode == 0 else "Apple Silicon"

        # Apple Silicon shares unified memory; report total RAM as available to GPU
        total_ram = psutil.virtual_memory().total / (1024**3)

        return GpuInfo(
            name=cpu_name,
            vram_gb=round(total_ram, 1),  # Unified memory
            metal_support=True,
        )
    except Exception as exc:
        logger.debug("Apple Metal detection failed: %s", exc)
        return None
