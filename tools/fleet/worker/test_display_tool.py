import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tools.fleet.lib.config import WorkerConfig
from tools.fleet.lib.models import Task, TaskStatus, TaskType
from tools.fleet.worker.daemon import WorkerDaemon


class DisplayToolTest(unittest.IsolatedAsyncioTestCase):
    def make_worker(self, os_name: str) -> WorkerDaemon:
        config = WorkerConfig(worker_id="test-worker")
        with patch("tools.fleet.worker.daemon.detect_hardware") as detect:
            detect.return_value = SimpleNamespace(os=os_name)
            return WorkerDaemon(config)

    def make_task(self) -> Task:
        return Task(
            task_type=TaskType.TOOL_CALL,
            model="tool",
            prompt="",
            metadata={
                "tool_name": "display",
                "args": {"uri": "https://example.com/mirror.png"},
            },
        )

    async def test_display_uses_startfile_on_windows(self):
        worker = self.make_worker("windows")
        with patch("tools.fleet.worker.daemon.os.startfile", create=True) as startfile:
            result = await worker._execute_tool_call_task(self.make_task())

        self.assertEqual(result.status, TaskStatus.COMPLETED)
        startfile.assert_called_once_with("https://example.com/mirror.png")
        self.assertEqual(result.result["tool_name"], "display")

    async def test_display_uses_open_on_macos(self):
        worker = self.make_worker("darwin")

        async def fake_exec(*args):
            return SimpleNamespace(pid=123)

        with patch("tools.fleet.worker.daemon.asyncio.create_subprocess_exec", side_effect=fake_exec) as exec_mock:
            result = await worker._execute_tool_call_task(self.make_task())

        self.assertEqual(result.status, TaskStatus.COMPLETED)
        exec_mock.assert_called_once_with("open", "https://example.com/mirror.png")

    async def test_display_uses_xdg_open_on_linux(self):
        worker = self.make_worker("linux")

        async def fake_exec(*args):
            return SimpleNamespace(pid=456)

        with patch("tools.fleet.worker.daemon.asyncio.create_subprocess_exec", side_effect=fake_exec) as exec_mock:
            result = await worker._execute_tool_call_task(self.make_task())

        self.assertEqual(result.status, TaskStatus.COMPLETED)
        exec_mock.assert_called_once_with("xdg-open", "https://example.com/mirror.png")


if __name__ == "__main__":
    unittest.main()
