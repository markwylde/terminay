"""Session bus address for supervised commands in a bot container.

The desktop session publishes its D-Bus address in BUS_FILE. Every supervised
command gets that address, or ``disabled:`` when the desktop bus is not running.
Without an address, a D-Bus client with a display auto-launches a private
``dbus-daemon --fork``. That daemon calls setsid, leaves the supervised process
group, and is never cleaned up.
"""
import os

BUS_FILE = "/run/terminay/desktop/bus"
DISABLED = "disabled:"


def session_bus_address(bus_file=BUS_FILE):
    try:
        with open(bus_file, encoding="utf-8") as f:
            address = f.read(4096).strip()
    except (FileNotFoundError, PermissionError, IsADirectoryError, UnicodeDecodeError):
        return DISABLED
    for part in address.split(";")[0].split(":", 1)[-1].split(","):
        key, _, value = part.partition("=")
        if key == "path" and address.startswith("unix:") and os.path.exists(value):
            return address
    return DISABLED


def with_session_bus(env, bus_file=BUS_FILE):
    """Return env with DBUS_SESSION_BUS_ADDRESS always replaced."""
    result = dict(env)
    result["DBUS_SESSION_BUS_ADDRESS"] = session_bus_address(bus_file)
    return result
