"""Session bus address for supervised commands.

The unit cases run anywhere. ContainerLeakTest runs only as root inside a
disposable, bootstrapped bot container (TERMINAY_BOT_CONTAINER_TEST=1), never
a live bot.
"""
import importlib.machinery
import importlib.util
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, "/usr/local/lib/terminay")
sys.path.insert(0, str(HERE / "bin"))
import terminay_bus  # noqa: E402


class SessionBusAddressTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.bus_file = os.path.join(self.dir.name, "bus")
        self.socket_path = os.path.join(self.dir.name, "dbus-test")

    def tearDown(self):
        self.dir.cleanup()

    def write(self, text):
        with open(self.bus_file, "w") as f:
            f.write(text)

    def listen(self):
        server = socket.socket(socket.AF_UNIX)
        server.bind(self.socket_path)
        self.addCleanup(server.close)

    def test_present_bus(self):
        self.listen()
        address = f"unix:path={self.socket_path},guid=abc"
        self.write(address + "\n")
        self.assertEqual(terminay_bus.session_bus_address(self.bus_file), address)

    def test_missing_file_is_disabled(self):
        self.assertEqual(terminay_bus.session_bus_address(self.bus_file), "disabled:")

    def test_stale_socket_is_disabled(self):
        self.write(f"unix:path={self.socket_path},guid=abc\n")
        self.assertEqual(terminay_bus.session_bus_address(self.bus_file), "disabled:")

    def test_non_path_address_is_disabled(self):
        self.write("autolaunch:\n")
        self.assertEqual(terminay_bus.session_bus_address(self.bus_file), "disabled:")

    def test_caller_values_are_replaced(self):
        self.listen()
        address = f"unix:path={self.socket_path}"
        self.write(address)
        for value in ("", "autolaunch:", "unix:path=/tmp/gone", None):
            env = {"HOME": "/home/bot"}
            if value is not None:
                env["DBUS_SESSION_BUS_ADDRESS"] = value
            result = terminay_bus.with_session_bus(env, self.bus_file)
            self.assertEqual(result["DBUS_SESSION_BUS_ADDRESS"], address)
            self.assertEqual(result["HOME"], "/home/bot")

    @unittest.skipUnless((HERE / "bin" / "terminay-run").exists(), "source tree only")
    def test_supervised_commands_use_helper(self):
        for name in ("terminay-run", "terminay-app", "terminay-browser"):
            text = (HERE / "bin" / name).read_text()
            self.assertIn("with_session_bus(", text, name)
        self.assertIn("COPY bin/terminay_bus.py /usr/local/lib/terminay/", (HERE / "Dockerfile").read_text())


def dbus_daemons():
    count = 0
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            comm = pathlib.Path(f"/proc/{pid}/comm").read_text().strip()
            state = pathlib.Path(f"/proc/{pid}/stat").read_text().split(") ")[1].split()[0]
        except (FileNotFoundError, ProcessLookupError, IndexError):
            continue
        if comm == "dbus-daemon" and state not in ("Z", "X"):
            count += 1
    return count


@unittest.skipUnless(
    os.environ.get("TERMINAY_BOT_CONTAINER_TEST") == "1" and os.geteuid() == 0,
    "runs only as root in a disposable bot container",
)
class ContainerLeakTest(unittest.TestCase):
    def run_session(self, sid, command, env=None):
        return subprocess.run(
            ["terminay-run", sid, "--", "sh", "-c", command],
            env={**os.environ, "DISPLAY": ":1", **(env or {})},
            capture_output=True, text=True, timeout=30,
        )

    # Go's D-Bus client (used by `tea`) runs `dbus-launch` for a new private bus
    # whenever the address is unset, empty or `autolaunch:`. The daemon forks,
    # calls setsid and outlives the supervised group. This mimics that rule.
    GODBUS_LIKE = (
        'case "${DBUS_SESSION_BUS_ADDRESS-}" in ""|autolaunch:*) '
        "dbus-launch --binary-syntax --close-stderr >/dev/null 2>&1 ;; esac; true"
    )

    def test_opening_the_bus_never_starts_a_daemon(self):
        before = dbus_daemons()
        for i, caller in enumerate(["", "autolaunch:"] * 10):
            self.run_session(f"dbus-leak-{i}", self.GODBUS_LIKE, {"DBUS_SESSION_BUS_ADDRESS": caller})
        time.sleep(1)  # one-off settle for forked daemons; a test, not production polling
        self.assertLessEqual(dbus_daemons(), before)

    def test_supervised_command_sees_desktop_or_disabled(self):
        result = self.run_session("dbus-env", 'printf %s "$DBUS_SESSION_BUS_ADDRESS"', {"DBUS_SESSION_BUS_ADDRESS": ""})
        self.assertEqual(result.stdout, terminay_bus.session_bus_address())
        self.assertTrue(result.stdout == "disabled:" or result.stdout.startswith("unix:path="))


if __name__ == "__main__":
    unittest.main()
