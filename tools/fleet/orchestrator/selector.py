"""
poc/orchestrator/selector.py -- Model selector.

Classifies tasks by type, scores all (model, node) pairs,
and selects the best combination. Scoring weights:
  - Capability match: 40%
  - Cost: 30%
  - Latency: 20%
  - Locality preference: 10%

Reuses task classification patterns from models/routing_policy.py.
Scoring formula derived from models/intelligent_router.py.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from tools.fleet.lib.models import (
    ModelInfo,
    ModelSelection,
    NodeInfo,
    NodeStatus,
    ProjectConstraints,
)

logger = logging.getLogger(__name__)

# ======================================================================
# Task Classification (reused from models/routing_policy.py)
# ======================================================================

CODING_PATTERNS = [
    r"\bcode\b", r"\bfunction\b", r"\bclass\b", r"\bimplement\b",
    r"\bpython\b", r"\bjavascript\b", r"\bscript\b", r"\bbug\b",
    r"\bdebug\b", r"\brefactor\b", r"\bAPI\b", r"\bSQL\b",
]

REASONING_PATTERNS = [
    r"\banalyze\b", r"\breason\b", r"\bexplain\b", r"\bcompare\b",
    r"\bevaluate\b", r"\bresearch\b", r"\bsummarize\b", r"\bcritique\b",
    r"\bstrateg\b", r"\bplan\b",
]

WRITING_PATTERNS = [
    r"\bwrite\b", r"\bdraft\b", r"\bcompose\b", r"\bcopy\b",
    r"\bcreative\b", r"\bblog\b", r"\barticle\b", r"\bemail\b",
    r"\bad\s", r"\bcampaign\b", r"\bmarketing\b",
]

TASK_CATEGORIES = {
    "coding": CODING_PATTERNS,
    "reasoning": REASONING_PATTERNS,
    "writing": WRITING_PATTERNS,
}


def classify_task(description: str) -> str:
    """Classify a task description into a category."""
    description_lower = description.lower()
    scores: dict[str, int] = {}
    for category, patterns in TASK_CATEGORIES.items():
        count = sum(1 for p in patterns if re.search(p, description_lower))
        scores[category] = count

    if not any(scores.values()):
        return "general"

    return max(scores, key=lambda k: scores[k])


# ======================================================================
# Quality Score Defaults
# ======================================================================

# Default quality scores by model family and task category.
# These are used when a model doesn't report its own scores.
DEFAULT_QUALITY: dict[str, dict[str, float]] = {
    "deepseek": {"reasoning": 0.88, "coding": 0.82, "writing": 0.75, "general": 0.80},
    "mistral": {"reasoning": 0.78, "coding": 0.75, "writing": 0.87, "general": 0.82},
    "qwen": {"reasoning": 0.80, "coding": 0.88, "writing": 0.78, "general": 0.80},
    "llama": {"reasoning": 0.82, "coding": 0.80, "writing": 0.80, "general": 0.82},
    "phi": {"reasoning": 0.84, "coding": 0.83, "writing": 0.76, "general": 0.80},
}


def _get_quality_score(model: ModelInfo, category: str) -> float:
    """Get quality score for a model in a category."""
    # Check model-reported scores first
    if model.quality_scores and category in model.quality_scores:
        return model.quality_scores[category]

    # Fall back to defaults based on model family
    model_lower = model.model_id.lower()
    for family, scores in DEFAULT_QUALITY.items():
        if family in model_lower:
            return scores.get(category, scores.get("general", 0.5))

    return 0.5  # Unknown model


def _cloud_cost_score(model: ModelInfo) -> float:
    """
    Convert estimated cloud model cost into normalized score [0.05, 1.0].

    Local models are handled separately as fully cost-efficient.
    """
    # Cost in USD per 1k tokens; defaults to a medium cloud baseline.
    cost_per_1k = model.estimated_cost_per_1k_tokens_usd or 0.004
    # 0.020 USD / 1k is treated as very expensive in this POC heuristic.
    normalized = 1.0 - min(cost_per_1k / 0.020, 0.95)
    return round(max(0.05, normalized), 4)


# ======================================================================
# Model Selector
# ======================================================================

# Scoring weights
W_CAPABILITY = 0.40
W_COST = 0.30
W_LATENCY = 0.20
W_LOCALITY = 0.10


class ModelSelector:
    """Selects the best (model, node) pair for a task."""

    def __init__(self, nodes_fn) -> None:
        """
        Args:
            nodes_fn: Callable that returns list[NodeInfo] of online nodes.
        """
        self._get_nodes = nodes_fn

    def select(
        self,
        task_description: str,
        task_category: Optional[str] = None,
        constraints: Optional[ProjectConstraints] = None,
        required_model: Optional[str] = None,
    ) -> Optional[ModelSelection]:
        """Select the best model and node for a task."""
        constraints = constraints or ProjectConstraints()
        category = task_category or classify_task(task_description)

        nodes = self._get_nodes()
        if not nodes:
            logger.warning("No online nodes available")
            return None

        # If a specific model is required, find nodes with it
        if required_model:
            candidates = self._find_candidates_for_model(required_model, nodes)
            if candidates:
                best = max(candidates, key=lambda c: c["score"])
                return self._make_selection(best, category)
            logger.warning("Required model %s not available on any node", required_model)
            # Fall through to general selection

        # Score all (model, node) pairs
        candidates = self._score_all_pairs(nodes, category, constraints)
        if not candidates:
            logger.warning("No suitable model+node found for category=%s", category)
            return None

        # Sort by score descending
        candidates.sort(key=lambda c: c["score"], reverse=True)

        best = candidates[0]
        fallbacks = [
            {"model_id": c["model"].model_id, "node_id": c["node"].node_id}
            for c in candidates[1:4]  # Up to 3 fallbacks
        ]

        selection = self._make_selection(best, category)
        selection.fallbacks = fallbacks
        return selection

    def _score_all_pairs(
        self,
        nodes: list[NodeInfo],
        category: str,
        constraints: ProjectConstraints,
    ) -> list[dict]:
        """Score every (model, node) combination."""
        candidates: list[dict] = []

        for node in nodes:
            if node.status != NodeStatus.ONLINE:
                continue
            if node.current_tasks >= node.max_concurrent_tasks:
                continue

            for model in node.models:
                score = self._score_pair(model, node, category, constraints)
                candidates.append({
                    "model": model,
                    "node": node,
                    "score": score,
                })

        return candidates

    def _score_pair(
        self,
        model: ModelInfo,
        node: NodeInfo,
        category: str,
        constraints: ProjectConstraints,
    ) -> float:
        """Score a single (model, node) pair."""
        # Capability score: quality for this task category
        capability = _get_quality_score(model, category)

        # Cost score: local = free, cloud = model-cost-aware heuristic.
        is_local = not node.url.startswith("cloud://")
        cost_score = 1.0 if is_local else _cloud_cost_score(model)

        # Latency score: based on available capacity
        capacity = node.max_concurrent_tasks - node.current_tasks
        latency_score = min(1.0, capacity / max(node.max_concurrent_tasks, 1))

        # Locality preference
        locality_score = 1.0 if is_local and constraints.prefer_local else 0.5

        total = (
            W_CAPABILITY * capability
            + W_COST * cost_score
            + W_LATENCY * latency_score
            + W_LOCALITY * locality_score
        )
        return round(total, 4)

    def _find_candidates_for_model(
        self, model_id: str, nodes: list[NodeInfo]
    ) -> list[dict]:
        """Find all nodes that have a specific model."""
        candidates: list[dict] = []
        for node in nodes:
            if node.status != NodeStatus.ONLINE:
                continue
            for model in node.models:
                if model.model_id == model_id:
                    candidates.append({
                        "model": model,
                        "node": node,
                        "score": 1.0,
                    })
        return candidates

    def _make_selection(self, candidate: dict, category: str) -> ModelSelection:
        """Create a ModelSelection from a scored candidate."""
        model: ModelInfo = candidate["model"]
        node: NodeInfo = candidate["node"]
        score: float = candidate["score"]

        explanation = f"Selected {model.model_id} on {node.node_id} (score={score:.2f}, category={category})"
        if node.url.startswith("cloud://"):
            explanation += (
                f", est_cost=${model.estimated_cost_per_1k_tokens_usd:.4f}/1k"
            )
            if model.provider:
                explanation += f", provider={model.provider}"

        return ModelSelection(
            model_id=model.model_id,
            node_id=node.node_id,
            node_url=node.url,
            score=score,
            explanation=explanation,
        )
