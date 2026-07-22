"""
poc/orchestrator/planner.py -- Project planner using Claude API.

Takes a project description and decomposes it into a sequence of
executable steps (PlanSteps) with dependencies.

DESIGN NOTE: The Planner intentionally uses a fixed Claude model and
bypasses the Model Selector. Planning requires the strongest available
model for reliable task decomposition. This is a design decision, not
an oversight. The Model Selector is for task execution routing, not
for the orchestrator's own reasoning. (See FLAG-ARCH-3 in vision
alignment report.)
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from tools.fleet.lib.models import (
    PlanStep,
    ProjectConstraints,
    ProjectPlan,
    TaskType,
)

logger = logging.getLogger(__name__)

PLANNING_SYSTEM_PROMPT = """You are a project planner for an AI agency platform called SimpleMiniions.

Your job is to decompose a project into a sequence of concrete, executable steps.
Each step will be executed by an LLM on a worker node.

Rules:
1. Each step must be a single, focused task (one prompt -> one output)
2. Steps can depend on prior steps (use depends_on indices)
3. Recommend specific models when you know which is best
4. Estimate token usage for each step
5. Keep steps small and composable (better to have 5 small steps than 2 giant ones)
6. The first step should gather context / do research
7. The last step should be synthesis / final assembly

Available models on worker nodes: {available_models}

Output format: JSON array of step objects:
[
  {{
    "step_index": 0,
    "description": "What this step does",
    "task_type": "llm",
    "recommended_model": null,
    "prompt_template": "The actual prompt. Use {{{{context}}}} for prior step results.",
    "depends_on": [],
    "estimated_tokens": 500
  }}
]

Return ONLY the JSON array. No commentary."""


class Planner:
    """
    Uses Claude API to decompose projects into executable plans.

    INTENTIONALLY bypasses Model Selector -- planning requires the
    strongest available model for reliable decomposition.
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

    async def create_plan(
        self,
        project_name: str,
        project_description: str,
        available_models: list[str],
        constraints: Optional[ProjectConstraints] = None,
        parameters: Optional[dict[str, Any]] = None,
    ) -> ProjectPlan:
        """Call Claude to decompose a project into steps."""
        constraints = constraints or ProjectConstraints()
        system = PLANNING_SYSTEM_PROMPT.format(
            available_models=", ".join(available_models) or "none yet"
        )

        user_msg = self._build_user_message(
            project_name, project_description, constraints, parameters or {}
        )

        response_text = await self._call_claude(system, user_msg)
        steps = self._parse_steps(response_text)

        total_cost = sum(s.estimated_cost_usd for s in steps)
        total_tokens = sum(s.estimated_tokens for s in steps)
        total_time = int(total_tokens / 500 * 2)

        plan = ProjectPlan(
            steps=steps,
            total_estimated_cost_usd=total_cost,
            total_estimated_time_seconds=total_time,
            planning_model=self.model,
        )

        logger.info(
            "Created plan with %d steps, est. cost=$%.4f, est. time=%ds",
            len(steps), total_cost, total_time,
        )
        return plan

    def _build_user_message(
        self,
        name: str,
        description: str,
        constraints: ProjectConstraints,
        parameters: dict[str, Any],
    ) -> str:
        parts = [f"Project: {name}", f"Description: {description}"]
        if parameters:
            parts.append(f"Parameters: {json.dumps(parameters, indent=2)}")
        if constraints.prefer_local:
            parts.append("Constraint: Prefer local models for privacy")
        if constraints.max_cost_usd:
            parts.append(f"Constraint: Max cost ${constraints.max_cost_usd}")
        if constraints.deadline_minutes:
            parts.append(f"Constraint: Must complete within {constraints.deadline_minutes} minutes")
        return "\n".join(parts)

    async def _call_claude(self, system: str, user_msg: str) -> str:
        """Make a single Claude API call."""
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self.model,
            "max_tokens": 4096,
            "system": system,
            "messages": [{"role": "user", "content": user_msg}],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.base_url}/v1/messages",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()

        data = resp.json()
        return data["content"][0]["text"]

    def _parse_steps(self, response_text: str) -> list[PlanStep]:
        """Parse Claude's JSON response into PlanStep objects."""
        text = response_text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        try:
            raw_steps = json.loads(text)
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse planner response: %s", exc)
            logger.debug("Raw response: %s", text[:500])
            return [
                PlanStep(
                    step_index=0,
                    description="Execute project (planning failed, single-step fallback)",
                    prompt_template=text,
                    estimated_tokens=1000,
                )
            ]

        steps: list[PlanStep] = []
        for raw in raw_steps:
            task_type_str = raw.get("task_type", "llm")
            try:
                task_type = TaskType(task_type_str)
            except ValueError:
                task_type = TaskType.LLM

            steps.append(
                PlanStep(
                    step_index=raw.get("step_index", len(steps)),
                    description=raw.get("description", ""),
                    task_type=task_type,
                    recommended_model=raw.get("recommended_model"),
                    prompt_template=raw.get("prompt_template", ""),
                    depends_on=raw.get("depends_on", []),
                    estimated_tokens=raw.get("estimated_tokens", 500),
                    estimated_cost_usd=raw.get("estimated_cost_usd", 0.0),
                )
            )
        return steps
