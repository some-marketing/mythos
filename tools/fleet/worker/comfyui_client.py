"""
poc/worker/comfyui_client.py -- ComfyUI HTTP client.

Pattern:
1. Build a simple workflow from prompt + params
2. Submit workflow to /prompt
3. Poll /history/{prompt_id} until outputs are available
4. Return output image metadata
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx


class ComfyUIClient:
    """Minimal async client for ComfyUI queue + history APIs."""

    def __init__(self, base_url: str = "http://localhost:8188") -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=60.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def health_check(self) -> bool:
        try:
            resp = await self._client.get(self.base_url)
            return resp.status_code < 500
        except Exception:
            return False

    async def generate_image(
        self,
        prompt: str,
        params: dict[str, Any] | None = None,
        timeout_seconds: int = 120,
    ) -> dict[str, Any]:
        """Submit a workflow and wait for output."""
        params = params or {}
        workflow = self._build_workflow(prompt, params)

        response = await self._client.post(
            f"{self.base_url}/prompt",
            json={"prompt": workflow, "client_id": str(uuid.uuid4())},
        )
        response.raise_for_status()
        payload = response.json()
        prompt_id = payload["prompt_id"]

        outputs = await self._poll_history(prompt_id, timeout_seconds=timeout_seconds)
        images = self._extract_images(outputs)

        return {
            "prompt_id": prompt_id,
            "images": images,
            "count": len(images),
            "provider": "comfyui",
        }

    def _build_workflow(self, prompt: str, params: dict[str, Any]) -> dict[str, Any]:
        """Build a small default ComfyUI graph."""
        width = int(params.get("width", 1024))
        height = int(params.get("height", 1024))
        steps = int(params.get("steps", 20))
        cfg = float(params.get("cfg", 7.0))
        seed = int(params.get("seed", 42))
        sampler_name = params.get("sampler_name", "euler")
        scheduler = params.get("scheduler", "normal")
        model = params.get("checkpoint", "sd_xl_base_1.0.safetensors")

        return {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": model},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": prompt, "clip": ["1", 1]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": params.get("negative_prompt", ""), "clip": ["1", 1]},
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": width, "height": height, "batch_size": 1},
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler_name,
                    "scheduler": scheduler,
                    "denoise": 1.0,
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": {"images": ["6", 0], "filename_prefix": "simpleminions"},
            },
        }

    async def _poll_history(
        self,
        prompt_id: str,
        timeout_seconds: int = 120,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout_seconds

        while asyncio.get_event_loop().time() < deadline:
            resp = await self._client.get(f"{self.base_url}/history/{prompt_id}")
            resp.raise_for_status()
            history = resp.json()
            if prompt_id in history:
                return history[prompt_id].get("outputs", {})
            await asyncio.sleep(poll_interval)

        raise TimeoutError(f"ComfyUI prompt {prompt_id} did not complete in time")

    def _extract_images(self, outputs: dict[str, Any]) -> list[dict[str, Any]]:
        images: list[dict[str, Any]] = []
        for node_output in outputs.values():
            for image in node_output.get("images", []):
                filename = image.get("filename")
                subfolder = image.get("subfolder", "")
                image_type = image.get("type", "output")
                image_url = (
                    f"{self.base_url}/view?filename={filename}&subfolder={subfolder}"
                    f"&type={image_type}"
                )
                images.append(
                    {
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": image_type,
                        "url": image_url,
                    }
                )
        return images
