"""
poc/orchestrator/synthesizer.py -- Result synthesizer.

Combines the results of all plan steps into a coherent final deliverable
using Claude API.

DESIGN NOTE: Like the Planner, the Synthesizer intentionally uses a fixed
Claude model and bypasses the Model Selector. Synthesis requires high-quality
reasoning to merge multiple outputs coherently. This is a design decision.
(See FLAG-ARCH-3 in vision alignment report.)
"""

from __future__ import annotations

import logging

import httpx

from tools.fleet.lib.models import ProjectPlan, TaskResult, TaskStatus

logger = logging.getLogger(__name__)

SYNTHESIS_SYSTEM_PROMPT = """You are a result synthesizer for an AI agency platform.

You receive the results from multiple task steps that were executed by different AI models.
Your job is to combine them into a single, coherent, polished final deliverable.

Rules:
1. Integrate all step results into a unified output
2. Resolve any contradictions between steps
3. Maintain consistent tone and style throughout
4. Add structure (headings, bullets) where appropriate
5. Remove any meta-commentary about the process
6. The output should look like it was written by one person

Output the final deliverable directly. No preamble."""


class ResultSynthesizer:
    """
    Combines multi-step results into a polished final output.

    INTENTIONALLY bypasses Model Selector -- synthesis requires
    high-quality reasoning from the strongest available model.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-5-20250929",
        base_url: str = "https://api.anthropic.com",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

    async def synthesize(
        self,
        project_name: str,
        project_description: str,
        step_results: dict[int, TaskResult],
        plan: ProjectPlan,
    ) -> str:
        """Synthesize all step results into a final deliverable."""
        successful: list[tuple[int, str]] = []
        for idx, result in sorted(step_results.items()):
            if result.status == TaskStatus.COMPLETED and result.result:
                text = result.result.get("text", "")
                if text.strip():
                    successful.append((idx, text))

        if not successful:
            return "[No results were produced. All steps failed.]"

        if len(successful) == 1:
            return successful[0][1]

        user_msg = self._build_synthesis_prompt(
            project_name, project_description, successful, plan
        )

        try:
            return await self._call_claude(SYNTHESIS_SYSTEM_PROMPT, user_msg)
        except Exception as exc:
            logger.error("Synthesis failed, concatenating results: %s", exc)
            parts = []
            for idx, text in successful:
                step_desc = plan.steps[idx].description if idx < len(plan.steps) else f"Step {idx}"
                parts.append(f"## {step_desc}\n\n{text}")
            return "\n\n---\n\n".join(parts)

    def _build_synthesis_prompt(
        self,
        project_name: str,
        project_description: str,
        results: list[tuple[int, str]],
        plan: ProjectPlan,
    ) -> str:
        parts = [
            f"Project: {project_name}",
            f"Description: {project_description}",
            "",
            "Step results to synthesize:",
        ]
        for idx, text in results:
            step_desc = (
                plan.steps[idx].description if idx < len(plan.steps) else f"Step {idx}"
            )
            parts.append(f"\n--- Step {idx}: {step_desc} ---\n{text}")
        parts.append("\nSynthesize these into a single, polished final deliverable.")
        return "\n".join(parts)

    async def _call_claude(self, system: str, user_msg: str) -> str:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self.model,
            "max_tokens": 8192,
            "system": system,
            "messages": [{"role": "user", "content": user_msg}],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self.base_url}/v1/messages",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
        data = resp.json()
        return data["content"][0]["text"]
