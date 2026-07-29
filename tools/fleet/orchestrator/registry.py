"""
poc/orchestrator/registry.py -- Worker node registry.

Tracks all known worker nodes, their models, hardware, and current load.
Nodes register via heartbeat. Nodes are marked DEGRADED after 60s and
OFFLINE after 90s without heartbeat.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from tools.fleet.lib.models import HeartbeatRequest, ModelInfo, NodeInfo, NodeStatus

logger = logging.getLogger(__name__)

DEGRADED_TIMEOUT = timedelta(seconds=60)
OFFLINE_TIMEOUT = timedelta(seconds=90)


class NodeRegistry:
    """In-memory registry of worker nodes."""

    def __init__(self) -> None:
        self._nodes: dict[str, NodeInfo] = {}

    def register_or_update(self, hb: HeartbeatRequest) -> None:
        """Register a new node or update an existing one from heartbeat."""
        now = datetime.utcnow()

        if hb.node_id in self._nodes:
            # Update existing node
            node = self._nodes[hb.node_id]
            node.url = hb.url
            node.hardware = hb.hardware
            node.models = hb.models
            node.capabilities = hb.capabilities
            node.current_tasks = hb.current_tasks
            node.max_concurrent_tasks = hb.max_concurrent_tasks
            node.status = hb.status
            node.last_heartbeat = now
            node.version = hb.version
            node.branch = hb.branch
            logger.debug("Updated node %s", hb.node_id)
        else:
            # Register new node
            self._nodes[hb.node_id] = NodeInfo(
                node_id=hb.node_id,
                hostname=hb.hostname,
                url=hb.url,
                status=hb.status,
                hardware=hb.hardware,
                models=hb.models,
                capabilities=hb.capabilities,
                current_tasks=hb.current_tasks,
                max_concurrent_tasks=hb.max_concurrent_tasks,
                last_heartbeat=now,
                version=hb.version,
                branch=hb.branch,
            )
            logger.info(
                "Registered node %s at %s with %d models",
                hb.node_id,
                hb.url,
                len(hb.models),
            )

    def get_all_nodes(self) -> list[NodeInfo]:
        """Get all known nodes (any status)."""
        self._check_timeouts()
        return list(self._nodes.values())

    def get_online_nodes(self) -> list[NodeInfo]:
        """Get only ONLINE nodes."""
        self._check_timeouts()
        return [n for n in self._nodes.values() if n.status == NodeStatus.ONLINE]

    def get_node(self, node_id: str) -> Optional[NodeInfo]:
        """Get a specific node by ID."""
        self._check_timeouts()
        return self._nodes.get(node_id)

    def find_nodes_with_model(self, model_id: str) -> list[NodeInfo]:
        """Find all online nodes that have a specific model."""
        self._check_timeouts()
        result: list[NodeInfo] = []
        for node in self._nodes.values():
            if node.status != NodeStatus.ONLINE:
                continue
            if any(m.model_id == model_id for m in node.models):
                result.append(node)
        return result

    def get_available_capacity(self, node_id: str) -> int:
        """Get remaining task capacity for a node."""
        node = self._nodes.get(node_id)
        if not node or node.status == NodeStatus.OFFLINE:
            return 0
        return max(0, node.max_concurrent_tasks - node.current_tasks)

    def _check_timeouts(self) -> None:
        """Update node status based on heartbeat recency."""
        now = datetime.utcnow()
        for node in self._nodes.values():
            if node.url.startswith("cloud://"):
                # Virtual cloud nodes are managed by config, not heartbeats.
                node.status = NodeStatus.ONLINE
                continue
            if node.last_heartbeat is None:
                continue
            elapsed = now - node.last_heartbeat
            if elapsed > OFFLINE_TIMEOUT:
                if node.status != NodeStatus.OFFLINE:
                    logger.warning(
                        "Node %s marked OFFLINE (no heartbeat for %s)",
                        node.node_id,
                        elapsed,
                    )
                    node.status = NodeStatus.OFFLINE
            elif elapsed > DEGRADED_TIMEOUT:
                if node.status == NodeStatus.ONLINE:
                    logger.warning(
                        "Node %s marked DEGRADED (no heartbeat for %s)",
                        node.node_id,
                        elapsed,
                    )
                    node.status = NodeStatus.DEGRADED
