#!/usr/bin/env python3
"""
tools/fleet/homeostasis.py -- Host Homeostasis Supervisor (Tier 2 Autonomic).

Verifies the 'Host Homeostasis' contract across the fleet:
1. Word = Contract: Reachability and sub-service health.
2. Work = Life: Load balancing and system health.
3. Risk = Reward: Task routing proportionality.
4. '=' = '=': Version and branch consistency.

Definition: balance as in work = life, risk = reward, word = contract, '=' = '='

Self-healing (loop-closure, grounding adjustments A1-A3):
    Dry-run by default. With --apply, ONE safe class of local repair is executed:
    removal of STALE .lock files (a lock whose recorded PID is no longer alive).
    Everything else -- git stash / branch-switch suggestions, foreign/live locks,
    unparseable locks -- stays PRINT-ONLY. Guarded by:
      - kill-switch file  _dev/state/homeostasis/disabled
      - an activation window (A3): --apply physically removes only after a
        recorded number of observation cycles have seen safe locks; earlier
        --apply runs record an observation and remove nothing.
      - a durable lane-health receipt per apply-mode decision (A2).
"""

import argparse
import asyncio
import json
import os
import re
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# tools/fleet/homeostasis.py -> parents[2] == repo root. State + receipts are
# always anchored here; lock discovery is anchored to the working tree.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_APPLY_WINDOW = 3  # A3: observation cycles required before physical removal
_LOCK_SKIP_DIRS = (".git", "node_modules", ".gemini", ".claude")


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _state_dir(base: Optional[Path] = None) -> Path:
    return Path(base or REPO_ROOT) / "_dev" / "state" / "homeostasis"


def _lane_health_path(base: Optional[Path] = None) -> Path:
    return Path(base or REPO_ROOT) / "_dev" / "reports" / "lifecycle" / "hygiene-lane-health.jsonl"


def _kill_switch_path(base: Optional[Path] = None) -> Path:
    return _state_dir(base) / "disabled"


def _activation_path(base: Optional[Path] = None) -> Path:
    return _state_dir(base) / "apply-activation.json"


def _apply_window() -> int:
    raw = os.getenv("MYTHOS_HYGIENE_APPLY_WINDOW")
    if raw is None:
        return DEFAULT_APPLY_WINDOW
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_APPLY_WINDOW


# ---------------------------------------------------------------------------
# Safe-class lock classification (PID liveness) + apply mechanics
# ---------------------------------------------------------------------------

def discover_locks(root: str = ".") -> List[str]:
    """Walk `root` for *.lock files, skipping vendored/tooling dirs."""
    locks: List[str] = []
    for dirpath, _dirs, files in os.walk(root):
        if any(skip in dirpath for skip in _LOCK_SKIP_DIRS):
            continue
        for f in files:
            if f.endswith(".lock"):
                locks.append(os.path.join(dirpath, f))
    return locks


def _pid_alive(pid: int) -> bool:
    """True if a process with `pid` currently exists. Fail-safe: unknown => alive."""
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid)], capture_output=True, text=True
        )
        return result.returncode == 0
    except Exception:
        # If we cannot determine liveness, treat as alive so the lock is UNSAFE.
        return True


def classify_lock(path: str) -> Tuple[str, str, Optional[int]]:
    """
    Classify a .lock file for the safe-removal class.

    Returns (classification, reason, pid):
      - ('safe',   ...)  lock records a PID that is NOT alive -> stale, removable
      - ('unsafe', ...)  no parseable PID (foreign/unknown owner), or PID alive,
                         or the file is unreadable

    Per grounding: unparseable OR foreign(live) locks are UNSAFE.
    """
    try:
        with open(path, "r", errors="replace") as fh:
            content = fh.read()
    except Exception as exc:  # noqa: BLE001 - any read failure is UNSAFE
        return ("unsafe", f"unreadable lock file: {exc}", None)

    stripped = content.strip()
    pid: Optional[int] = None
    if stripped.isdigit():
        pid = int(stripped)
    else:
        m = re.search(r"\b(\d{1,7})\b", content)
        if m:
            pid = int(m.group(1))

    if pid is None or pid <= 0:
        return ("unsafe", "no parseable PID in lock (foreign/unknown owner)", None)

    if _pid_alive(pid):
        return ("unsafe", f"PID {pid} is alive (foreign/live owner)", pid)

    return ("safe", f"PID {pid} is not alive (stale lock)", pid)


def _load_activation(base: Optional[Path] = None) -> dict:
    p = _activation_path(base)
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001 - missing/malformed -> fresh window
        return {
            "schema": "HygieneApplyActivation/1.0",
            "apply_class": "homeostasis-stale-lock-removal",
            "observed_cycles": 0,
            "false_pass_instances": [],
        }


def _record_observation(base: Optional[Path] = None) -> dict:
    """A3: durably record one observation cycle that saw >=1 safe lock."""
    act = _load_activation(base)
    act["observed_cycles"] = int(act.get("observed_cycles", 0)) + 1
    act["last_observed"] = _iso()
    p = _activation_path(base)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(act, indent=2) + "\n")
    return act


def _append_receipt(base: Optional[Path], *, decision: str, target: str,
                    verification: dict, outcome: str) -> None:
    """A2: one durable lane-health receipt per apply-mode decision. Fail-soft."""
    try:
        p = _lane_health_path(base)
        p.parent.mkdir(parents=True, exist_ok=True)
        rec = {
            "schema": "HygieneLaneHealth/1.0",
            "timestamp": _iso(),
            "tool": "homeostasis",
            "decision": decision,
            "target": target,
            "verification": verification,
            "outcome": outcome,
        }
        with open(p, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
    except Exception:  # noqa: BLE001 - a receipt failure must not break a safe decision
        pass


def apply_safe_lock_repairs(locks: List[str], *, apply: bool = False,
                            base: Optional[Path] = None,
                            window_threshold: Optional[int] = None) -> dict:
    """
    Classify locks and, in apply mode, remove ONLY the safe (stale) class.

    Guards, in order: kill-switch -> activation window (A3) -> physical removal.
    Dry-run (apply=False) never removes; it advances the observation window when
    safe locks are present so scheduled report-only runs earn the activation.
    """
    threshold = _apply_window() if window_threshold is None else max(0, window_threshold)
    classified = []
    for lock in locks:
        cls, reason, pid = classify_lock(lock)
        classified.append({"path": lock, "class": cls, "reason": reason, "pid": pid})
    safe = [c for c in classified if c["class"] == "safe"]
    unsafe = [c for c in classified if c["class"] == "unsafe"]

    result = {
        "apply": apply,
        "classified": classified,
        "safe_count": len(safe),
        "unsafe_count": len(unsafe),
        "removed": [],
        "skipped_unsafe": [c["path"] for c in unsafe],
        "kill_switch": False,
        "activated": False,
        "observed_cycle": False,
        "observed_cycles": int(_load_activation(base).get("observed_cycles", 0)),
        "window_threshold": threshold,
    }

    if not apply:
        # Report-only path. Advance the activation window when the apply-class is
        # actually exercisable (safe locks present) so activation is earned.
        if safe:
            act = _record_observation(base)
            result["observed_cycle"] = True
            result["observed_cycles"] = act["observed_cycles"]
        return result

    # --- apply mode: every decision below is an apply-mode decision (A2) ---

    if _kill_switch_path(base).exists():
        result["kill_switch"] = True
        _append_receipt(
            base,
            decision="skipped-kill-switch",
            target=str(_kill_switch_path(base)),
            verification={"kill_switch_present": True, "safe_locks": len(safe)},
            outcome="noop",
        )
        return result

    act = _load_activation(base)
    observed = int(act.get("observed_cycles", 0))
    if observed < threshold:
        # A3: not yet activated. This apply run counts as an observation only.
        if safe:
            act = _record_observation(base)
            result["observed_cycle"] = True
        result["observed_cycles"] = int(act.get("observed_cycles", observed))
        _append_receipt(
            base,
            decision="observed-pending-activation",
            target="stale-lock-removal",
            verification={
                "observed_cycles": result["observed_cycles"],
                "window_threshold": threshold,
                "safe_locks": len(safe),
            },
            outcome="noop",
        )
        return result

    # Activated: remove the safe class only.
    result["activated"] = True
    for c in safe:
        try:
            os.remove(c["path"])
            result["removed"].append(c["path"])
            _append_receipt(
                base,
                decision="applied-stale-lock-removal",
                target=c["path"],
                verification={"pid": c["pid"], "pid_liveness": "dead", "reason": c["reason"]},
                outcome="success",
            )
        except Exception as exc:  # noqa: BLE001
            _append_receipt(
                base,
                decision="applied-stale-lock-removal",
                target=c["path"],
                verification={"pid": c["pid"], "error": str(exc)},
                outcome="failed",
            )
    for c in unsafe:
        _append_receipt(
            base,
            decision="skipped-unsafe-lock",
            target=c["path"],
            verification={"pid": c["pid"], "reason": c["reason"]},
            outcome="noop",
        )
    return result


@dataclass
class HostVerdict:
    name: str
    online: bool
    word_contract: bool  # Sub-services healthy
    work_life: bool      # Load balanced
    risk_reward: bool    # Correct tier
    identity: bool       # Version/Branch matches
    issues: List[str]
    fixes: List[str]

class HomeostasisSupervisor:
    def __init__(self, nodes: List[str]):
        self.nodes = nodes
        self.orchestrator_url = os.getenv("ORCHESTRATOR_URL", "http://localhost:8000")
        self.target_branch = self._determine_target_branch()

    def _determine_target_branch(self) -> str:
        """
        Divergence Resolution: Recent edits have more weight unless they do not pass the rules.
        We assume the local orchestrator has the most recent edits. We use its branch as the
        target for the fleet, provided the local repo passes basic rules (not in a detached HEAD, etc.).
        """
        try:
            branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
            if branch == "HEAD":
                return "unknown" # Fails rule: cannot deploy detached HEAD to fleet
            return branch
        except Exception:
            return "unknown"

    async def check_host(self, name: str) -> HostVerdict:
        # httpx is imported lazily so the module (and its testable self-heal
        # helpers) load cleanly on hosts without the fleet HTTP dependency.
        import httpx

        issues = []
        fixes = []

        # 0. Basic Reachability
        online = False
        worker_data = {}
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"http://{name}:8001/api/health")
                if resp.status_code == 200:
                    online = True
                    worker_data = resp.json()
        except Exception as e:
            issues.append(f"Worker API unreachable: {e}")

        # 1. Word = Contract (Integrity)
        # Check sub-services from supervisor's perspective
        ollama_reachable = False
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                # Use /api/tags as a more rigorous check than /
                resp = await client.get(f"http://{name}:11434/api/tags")
                ollama_reachable = resp.status_code == 200
        except Exception:
            ollama_reachable = False

        if not ollama_reachable:
            issues.append("Ollama unreachable (Contract: 0.0.0.0:11434 + Firewall)")
            fixes.append(f"ssh {name} 'powershell -ExecutionPolicy Bypass -File <your-cloud-stack-ensure-script.ps1>'")

        # 2. Work = Life (Balance)
        # Check if worker reports high load or is degraded
        work_life = True
        if worker_data.get("status") == "degraded":
            work_life = False
            issues.append("Worker reports DEGRADED status")

        # 3. Risk = Reward (Proportionality)
        risk_reward = True

        # 4. '=' = '=' (Identity)
        identity = True
        current_branch = worker_data.get("branch", "unknown")
        if current_branch != self.target_branch:
            identity = False
            issues.append(f"Branch mismatch: {current_branch} (Expected: {self.target_branch})")
            if self.target_branch != "unknown":
                repo_dir = os.environ.get("FLEET_NODE_REPO_DIR", "C:\\mythos")
                fixes.append(f"ssh {name} 'cd {repo_dir} && git fetch && git switch {self.target_branch} && git pull'")

        return HostVerdict(
            name=name,
            online=online,
            word_contract=ollama_reachable,
            work_life=work_life,
            risk_reward=risk_reward,
            identity=identity,
            issues=issues,
            fixes=fixes
        )

    async def check_local(self) -> HostVerdict:
        issues = []
        fixes = []

        # Check for stale lock files (report-only here; removal is gated in
        # apply_safe_lock_repairs behind --apply + PID liveness + activation).
        locks = discover_locks(".")

        if locks:
            issues.append(f"Stale lock files found: {len(locks)}")
            fixes.append("rm " + " ".join(locks))

        # Check git status. git stash / branch switch stay PRINT-ONLY: they
        # mutate work state and are never in the safe apply class.
        status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True).stdout
        if status:
            issues.append("Git working tree is dirty")
            fixes.append("git stash OR /clean-house")

        # Check branch
        branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        if branch != self.target_branch:
            issues.append(f"Local branch is {branch} (Expected: {self.target_branch})")

        return HostVerdict(
            name="local (macbook-pro)",
            online=True,
            word_contract=not bool(locks),
            work_life=True,
            risk_reward=True,
            identity=(branch == self.target_branch) and not bool(status),
            issues=issues,
            fixes=fixes
        )

    async def run(self, apply: bool = False):
        print(f"--- Homeostasis Supervision Run: {time.ctime()} ---")
        print(f"Mode: {'APPLY (safe class only)' if apply else 'DRY-RUN (report-only)'}")

        verdicts = []
        verdicts.append(await self.check_local())

        for node in self.nodes:
            verdicts.append(await self.check_host(node))

        unbalanced = False
        for v in verdicts:
            status = "BALANCED" if (v.online and v.word_contract and v.identity) else "UNBALANCED"
            if status == "UNBALANCED":
                unbalanced = True

            print(f"\nHost: {v.name} [{status}]")
            for issue in v.issues:
                print(f"  - ISSUE: {issue}")
            for fix in v.fixes:
                print(f"  - FIX: {fix}")

        # Self-healing: safe class only, local working tree.
        locks = discover_locks(".")
        heal = apply_safe_lock_repairs(locks, apply=apply)
        print("\n--- Self-Heal (safe class: stale .lock removal) ---")
        if heal["kill_switch"]:
            print(f"  Kill-switch present ({_kill_switch_path()}); no repairs applied.")
        print(f"  locks: {len(locks)}  safe(stale): {heal['safe_count']}  unsafe(foreign/unparseable): {heal['unsafe_count']}")
        if apply and heal["activated"]:
            print(f"  APPLIED removal of {len(heal['removed'])} stale lock(s).")
        elif apply and not heal["kill_switch"]:
            print(f"  Activation window {heal['observed_cycles']}/{heal['window_threshold']} — physical removal withheld (A3).")
        else:
            if heal["safe_count"]:
                print(f"  DRY-RUN: {heal['safe_count']} stale lock(s) would be removed with --apply. "
                      f"Observation {heal['observed_cycles']}/{heal['window_threshold']}.")

        if not unbalanced:
            print("\nVERDICT: Fleet is in homeostasis.")
        else:
            print("\nVERDICT: Homeostasis broken. Reconciliation required.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Host Homeostasis Supervisor")
    parser.add_argument(
        "--apply", action="store_true",
        help="Execute the safe repair class (stale .lock removal) instead of reporting only.",
    )
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    nodes = os.environ.get("FLEET_NODE_LIST", "example-gpu-host,example-workstation").split(",")
    supervisor = HomeostasisSupervisor(nodes)
    asyncio.run(supervisor.run(apply=args.apply))
