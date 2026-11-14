import subprocess
import unittest
from unittest.mock import patch

from desktop_window import wait_for_window


class WindowReadinessTests(unittest.TestCase):
    @patch("desktop_window.time.sleep")
    @patch("desktop_window.subprocess.run")
    def test_window_destroyed_during_scan_is_retried(self, run, sleep):
        run.side_effect = [
            subprocess.CompletedProcess([], 1, "", "BadWindow (invalid Window parameter)"),
            subprocess.CompletedProcess([], 1, "", ""),
            subprocess.CompletedProcess([], 0, "123\n", ""),
        ]
        self.assertEqual(wait_for_window(45, "--name", "about:blank"), "123")
        self.assertEqual(run.call_count, 3)
        self.assertEqual(run.call_args.args[0], [
            "xdotool", "search", "--onlyvisible", "--name", "about:blank"
        ])
        self.assertLessEqual(run.call_args.kwargs["timeout"], 45)

    @patch("desktop_window.time.sleep")
    @patch("desktop_window.time.monotonic", side_effect=[0, 0, 0.5, 1])
    @patch("desktop_window.subprocess.run")
    def test_missing_window_fails_at_deadline_with_last_error(self, run, monotonic, sleep):
        run.return_value = subprocess.CompletedProcess([], 1, "", "BadWindow")
        with self.assertRaisesRegex(TimeoutError, "within 1s: BadWindow"):
            wait_for_window(1, "--pid", "42")
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.kwargs["timeout"], 1)

    @patch("desktop_window.subprocess.run", side_effect=subprocess.TimeoutExpired("xdotool", 1))
    def test_stuck_scan_fails(self, run):
        with self.assertRaises(subprocess.TimeoutExpired):
            wait_for_window(1, "--pid", "42")


if __name__ == "__main__":
    unittest.main()
