"""Bounded window readiness checks for the real-container desktop gate."""

import subprocess
import sys
import time


def wait_for_window(timeout, *criteria):
    deadline = time.monotonic() + timeout
    diagnostic = "no matching visible window"
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"Window did not appear within {timeout}s: {diagnostic}")
        # X clients can destroy a window while xdotool walks the tree. Even
        # --sync exits on that BadWindow error, so retry independent snapshots.
        result = subprocess.run(
            ["xdotool", "search", "--onlyvisible", *criteria],
            capture_output=True,
            text=True,
            timeout=remaining,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        diagnostic = result.stderr.strip() or "no matching visible window"
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))


if __name__ == "__main__":
    print(wait_for_window(float(sys.argv[1]), *sys.argv[2:]))
