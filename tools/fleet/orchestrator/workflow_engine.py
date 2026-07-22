"""
poc/orchestrator/workflow_engine.py -- Workflow template engine.

Loads YAML workflow templates, validates parameters, resolves step
dependencies, and converts to ProjectPlan. This replaces the Claude-based
Planner for template-driven projects (faster, free, deterministic).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from tools.fleet.lib.models import (
    PlanStep,
    ProjectPlan,
    TaskParameters,
    TaskType,
    WorkflowStepTemplate,
    WorkflowTemplate,
)

logger = logging.getLogger(__name__)


class WorkflowLoadError(Exception):
    """Raised when a workflow template cannot be loaded or validated."""
    pass


class WorkflowEngine:
    """Loads, validates, and converts workflow templates to ProjectPlans."""

    def __init__(self, template_dir: str = "workflows") -> None:
        self.template_dir = Path(template_dir)
        self._cache: dict[str, WorkflowTemplate] = {}

    def load_template(self, name: str) -> WorkflowTemplate:
        """Load a workflow template by name from {template_dir}/{name}.yaml."""
        if name in self._cache:
            return self._cache[name]

        path = self.template_dir / f"{name}.yaml"
        if not path.exists():
            raise WorkflowLoadError(f"Template not found: {path}")

        with open(path, "r") as f:
            raw = yaml.safe_load(f)

        template = self._parse_template(raw, name)
        self._cache[name] = template
        logger.info("Loaded workflow template '%s' with %d steps", name, len(template.steps))
        return template

    def list_templates(self) -> list[str]:
        """List all available template names."""
        if not self.template_dir.exists():
            return []
        return [p.stem for p in self.template_dir.glob("*.yaml") if p.is_file()]

    def validate_parameters(
        self, template: WorkflowTemplate, parameters: dict[str, Any]
    ) -> list[str]:
        """Validate that all required parameters are provided. Returns error list."""
        errors: list[str] = []
        for param in template.required_parameters:
            if param not in parameters:
                errors.append(f"Missing required parameter: {param}")
            elif not str(parameters[param]).strip():
                errors.append(f"Empty required parameter: {param}")
        return errors

    def to_project_plan(
        self,
        template: WorkflowTemplate,
        project_id: str,
        parameters: dict[str, Any],
    ) -> ProjectPlan:
        """Convert a WorkflowTemplate + parameters into a ProjectPlan."""
        name_to_index: dict[str, int] = {}
        for idx, step in enumerate(template.steps):
            name_to_index[step.name] = idx

        plan_steps: list[PlanStep] = []
        for idx, step in enumerate(template.steps):
            dep_indices: list[int] = []
            for dep_name in step.depends_on:
                if dep_name in name_to_index:
                    dep_indices.append(name_to_index[dep_name])
                else:
                    logger.warning(
                        "Unknown dependency '%s' in step '%s'", dep_name, step.name
                    )

            prompt = step.prompt_template
            for key, value in parameters.items():
                placeholder = "{{" + key + "}}"
                prompt = prompt.replace(placeholder, str(value))

            plan_steps.append(
                PlanStep(
                    step_index=idx,
                    description=step.name.replace("_", " ").title(),
                    task_type=step.task_type,
                    recommended_model=step.model_preference,
                    prompt_template=prompt,
                    depends_on=dep_indices,
                    estimated_tokens=step.parameters.max_tokens,
                )
            )

        return ProjectPlan(
            project_id=project_id,
            steps=plan_steps,
            planning_model="workflow_template",
        )

    def _parse_template(self, raw: dict[str, Any], name: str) -> WorkflowTemplate:
        """Parse raw YAML dict into a WorkflowTemplate."""
        steps: list[WorkflowStepTemplate] = []
        for raw_step in raw.get("steps", []):
            task_type_str = raw_step.get("task_type", "llm")
            try:
                task_type = TaskType(task_type_str)
            except ValueError:
                task_type = TaskType.LLM

            params_raw = raw_step.get("parameters", {})
            params = TaskParameters(
                temperature=params_raw.get("temperature", 0.7),
                max_tokens=params_raw.get("max_tokens", 1024),
                top_p=params_raw.get("top_p", 0.9),
            )

            steps.append(
                WorkflowStepTemplate(
                    name=raw_step["name"],
                    task_type=task_type,
                    prompt_template=raw_step.get("prompt_template", ""),
                    model_preference=raw_step.get("model_preference"),
                    depends_on=raw_step.get("depends_on", []),
                    parameters=params,
                )
            )

        return WorkflowTemplate(
            name=raw.get("name", name),
            description=raw.get("description", ""),
            version=raw.get("version", "1.0"),
            required_parameters=raw.get("required_parameters", []),
            steps=steps,
        )
