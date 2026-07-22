#!/usr/bin/env python3
"""
Tests for tools/fleet/homeostasis.py self-healing (safe-class stale-lock removal).

Stdlib only (unittest). Loads homeostasis.py directly via importlib so the test
does not depend on the fleet HTTP stack (httpx is lazily imported).

Run: python3 tools/fleet/test_homeostasis.py
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location("homeostasis_under_test", _HERE / "homeostasis.py")
H = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(H)


def _dead_pid() -> int:
    """Spawn a trivial process, wait for it to exit, return its now-dead PID."""
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    # Give the OS a beat to reap; the PID should not correspond to a live proc.
    time.sleep(0.05)
    return p.pid


class ClassifyLockTest(unittest.TestCase):
    def _lock(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".lock")
        with os.fdopen(fd, "w") as fh:
            fh.write(content)
        return path

    def test_stale_pid_is_safe(self):
        path = self._lock(str(_dead_pid()))
        cls, reason, pid = H.classify_lock(path)
        self.assertEqual(cls, "safe", reason)
        self.assertIsNotNone(pid)

    def test_live_pid_is_unsafe(self):
        # The running test process is alive -> foreign/live owner -> UNSAFE.
        path = self._lock(str(os.getpid()))
        cls, reason, pid = H.classify_lock(path)
        self.assertEqual(cls, "unsafe", reason)

    def test_unparseable_lock_is_unsafe(self):
        path = self._lock("not-a-pid\n")
        cls, reason, pid = H.classify_lock(path)
        self.assertEqual(cls, "unsafe", reason)
        self.assertIsNone(pid)

    def test_empty_lock_is_unsafe(self):
        path = self._lock("")
        cls, reason, pid = H.classify_lock(path)
        self.assertEqual(cls, "unsafe", reason)


class ApplyTierTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        self.tree = Path(tempfile.mkdtemp())

    def _make_lock(self, name: str, content: str) -> str:
        p = self.tree / name
        p.write_text(content)
        return str(p)

    def _receipts(self):
        rp = H._lane_health_path(self.base)
        if not rp.exists():
            return []
        return [json.loads(l) for l in rp.read_text().splitlines() if l.strip()]

    def test_dry_run_never_removes_but_advances_window(self):
        safe = self._make_lock("a.lock", str(_dead_pid()))
        res = H.apply_safe_lock_repairs([safe], apply=False, base=self.base, window_threshold=2)
        self.assertEqual(res["removed"], [])
        self.assertTrue(os.path.exists(safe))
        self.assertTrue(res["observed_cycle"])
        self.assertEqual(res["observed_cycles"], 1)
        # No apply-mode receipt in dry-run.
        self.assertEqual(self._receipts(), [])

    def test_apply_withholds_until_activation_window(self):
        safe = self._make_lock("a.lock", str(_dead_pid()))
        # threshold=2, zero observations -> apply must NOT remove yet (A3).
        res = H.apply_safe_lock_repairs([safe], apply=True, base=self.base, window_threshold=2)
        self.assertFalse(res["activated"])
        self.assertEqual(res["removed"], [])
        self.assertTrue(os.path.exists(safe))
        receipts = self._receipts()
        self.assertTrue(any(r["decision"] == "observed-pending-activation" for r in receipts))

    def test_apply_removes_safe_only_after_activation(self):
        safe = self._make_lock("a.lock", str(_dead_pid()))
        unsafe = self._make_lock("b.lock", str(os.getpid()))
        # threshold=0 -> activated immediately.
        res = H.apply_safe_lock_repairs([safe, unsafe], apply=True, base=self.base, window_threshold=0)
        self.assertTrue(res["activated"])
        self.assertIn(safe, res["removed"])
        self.assertFalse(os.path.exists(safe))
        self.assertTrue(os.path.exists(unsafe))  # live/foreign lock preserved
        receipts = self._receipts()
        self.assertTrue(any(r["decision"] == "applied-stale-lock-removal" and r["outcome"] == "success" for r in receipts))
        self.assertTrue(any(r["decision"] == "skipped-unsafe-lock" for r in receipts))

    def test_kill_switch_blocks_apply(self):
        H._state_dir(self.base).mkdir(parents=True, exist_ok=True)
        H._kill_switch_path(self.base).write_text("disabled\n")
        safe = self._make_lock("a.lock", str(_dead_pid()))
        res = H.apply_safe_lock_repairs([safe], apply=True, base=self.base, window_threshold=0)
        self.assertTrue(res["kill_switch"])
        self.assertEqual(res["removed"], [])
        self.assertTrue(os.path.exists(safe))
        self.assertTrue(any(r["decision"] == "skipped-kill-switch" for r in self._receipts()))

    def test_idempotent_second_apply_is_noop(self):
        safe = self._make_lock("a.lock", str(_dead_pid()))
        H.apply_safe_lock_repairs([safe], apply=True, base=self.base, window_threshold=0)
        self.assertFalse(os.path.exists(safe))
        # Re-scan the (now empty) tree; nothing to remove, no error.
        locks = H.discover_locks(str(self.tree))
        res2 = H.apply_safe_lock_repairs(locks, apply=True, base=self.base, window_threshold=0)
        self.assertEqual(res2["removed"], [])
        self.assertEqual(res2["safe_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
