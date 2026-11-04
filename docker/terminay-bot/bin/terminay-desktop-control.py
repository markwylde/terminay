#!/usr/bin/env python3
"""Agent desktop control service.

Listens on the desktop's published CDP port. Requests under /terminay-desktop/ are
answered here (screenshots and input for the agent's desktop tools); every other
connection, including CDP WebSocket upgrades, is piped unchanged to Chromium's
loopback CDP endpoint. Sharing the CDP port means the worker's tokenized CDP proxy
(container agents) and the VM loopback endpoint (machine agents) reach the desktop
with no extra port or route.

Input is a fixed action vocabulary executed as xdotool/wmctrl argument vectors, never a
shell. Screenshots are xwd captures encoded to PNG in-process (stdlib only).
"""

import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import struct
import sys
import time
import urllib.parse
import zlib

PREFIX = "/terminay-desktop/"
MAX_HEADER_BYTES = 64 * 1024
MAX_BODY_BYTES = 256 * 1024
MAX_ACTIONS = 50
MAX_TEXT = 5000
MAX_WAIT_MS = 10_000
MAX_TOTAL_WAIT_MS = 30_000
MAX_SCROLL = 25
COMMAND_TIMEOUT_SEC = 15
SETTLE_SEC = 0.4
BUTTONS = {"left": "1", "middle": "2", "right": "3"}
SCROLL_BUTTONS = {"up": "4", "down": "5", "left": "6", "right": "7"}
APPS = {"terminal", "browser"}
KEY_TOKEN = re.compile(r"^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$")
URL_SCHEMES = ("http://", "https://", "about:", "file://")
WINDOW_ID = re.compile(r"^0x[0-9a-fA-F]{1,8}$")
WINDOW_ACTIONS = {"focus", "close", "move", "maximize", "restore"}
MAX_ZOOM = 4


class ActionError(Exception):
    pass


# ---------------------------------------------------------------- validation


def _int(action, name, low, high):
    value = action.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise ActionError(f"{name} must be a number")
    value = int(round(value))
    if value < low or value > high:
        raise ActionError(f"{name} must be between {low} and {high}")
    return value


def _point(action, screen, x="x", y="y"):
    width, height = screen
    return _int(action, x, 0, width - 1), _int(action, y, 0, height - 1)


def _has_point(action):
    return action.get("x") is not None or action.get("y") is not None


def plan_actions(actions, screen):
    """Validate an action batch and translate it into steps.

    Each step is ("xdotool", [args...]), ("move", (x, y)), ("sleep", seconds) or
    ("launch", [args...]). Moves are their own step so the executor can skip one
    that would not move the pointer: `mousemove --sync` to the current position
    waits for a motion event that never arrives.
    Raises ActionError naming the first invalid action.
    """
    if not isinstance(actions, list) or not actions:
        raise ActionError("actions must be a non-empty list")
    if len(actions) > MAX_ACTIONS:
        raise ActionError(f"at most {MAX_ACTIONS} actions per batch")
    steps = []
    total_wait = 0
    for index, action in enumerate(actions):
        try:
            if not isinstance(action, dict):
                raise ActionError("action must be an object")
            kind = action.get("type")
            if kind == "move":
                x, y = _point(action, screen)
                steps.append([("move", (x, y))])
            elif kind in ("click", "double_click", "right_click"):
                button = action.get("button", "left") if kind == "click" else ("right" if kind == "right_click" else "left")
                if button not in BUTTONS:
                    raise ActionError("button must be left, middle or right")
                count = 2 if kind == "double_click" else (_int(action, "count", 1, 3) if action.get("count") is not None else 1)
                group = []
                if _has_point(action):
                    x, y = _point(action, screen)
                    group.append(("move", (x, y)))
                group.append(("xdotool", ["click", "--repeat", str(count), "--delay", "80", BUTTONS[button]]))
                steps.append(group)
            elif kind == "drag":
                fx, fy = _point(action, screen, "fromX", "fromY")
                tx, ty = _point(action, screen, "toX", "toY")
                button = BUTTONS.get(action.get("button", "left"))
                if button is None:
                    raise ActionError("button must be left, middle or right")
                group = [
                    ("move", (fx, fy)),
                    ("xdotool", ["mousedown", button]),
                ]
                for step in range(1, 6):
                    mx = fx + (tx - fx) * step // 5
                    my = fy + (ty - fy) * step // 5
                    group.append(("sleep", 0.03))
                    group.append(("move", (mx, my)))
                group.append(("xdotool", ["mouseup", button]))
                steps.append(group)
            elif kind == "scroll":
                direction = action.get("direction")
                if direction not in SCROLL_BUTTONS:
                    raise ActionError("direction must be up, down, left or right")
                amount = _int(action, "amount", 1, MAX_SCROLL) if action.get("amount") is not None else 3
                group = []
                if _has_point(action):
                    x, y = _point(action, screen)
                    group.append(("move", (x, y)))
                group.append(("xdotool", ["click", "--repeat", str(amount), "--delay", "40", SCROLL_BUTTONS[direction]]))
                steps.append(group)
            elif kind == "type":
                text = action.get("text")
                if not isinstance(text, str) or not text:
                    raise ActionError("text must be a non-empty string")
                if len(text) > MAX_TEXT:
                    raise ActionError(f"text must be at most {MAX_TEXT} characters")
                steps.append([("xdotool", ["type", "--delay", "12", "--", text])])
            elif kind == "key":
                keys = action.get("keys")
                if not isinstance(keys, str) or not keys.strip():
                    raise ActionError("keys must be a non-empty string such as \"ctrl+l\" or \"Return\"")
                tokens = keys.split()
                if len(tokens) > 20 or not all(KEY_TOKEN.match(token) for token in tokens):
                    raise ActionError("keys must be xdotool key names joined with + (for example ctrl+shift+t), separated by spaces")
                steps.append([("xdotool", ["key", "--delay", "40", "--", *tokens])])
            elif kind == "wait":
                ms = _int(action, "ms", 0, MAX_WAIT_MS)
                total_wait += ms
                if total_wait > MAX_TOTAL_WAIT_MS:
                    raise ActionError(f"waits may total at most {MAX_TOTAL_WAIT_MS} ms per batch")
                steps.append([("sleep", ms / 1000)])
            elif kind == "launch":
                app = action.get("app")
                if app not in APPS:
                    raise ActionError("app must be terminal or browser")
                args = [app]
                url = action.get("url")
                if url is not None:
                    if app != "browser":
                        raise ActionError("url is only valid for the browser")
                    if not isinstance(url, str) or len(url) > 4096 or not url.startswith(URL_SCHEMES):
                        raise ActionError("url must be an http(s), about: or file:// URL")
                    args.append(url)
                steps.append([("launch", args), ("sleep", 1.0)])
            else:
                raise ActionError("type must be one of move, click, double_click, right_click, drag, scroll, type, key, wait, launch")
        except ActionError as error:
            raise ActionError(f"actions[{index}]: {error}") from None
    return steps


# ---------------------------------------------------------------- screenshots


DIRECT_COLOR = 5


def xwd_to_rgb(data):
    """Decode a TrueColor/DirectColor ZPixmap XWD dump (as written by `xwd -root`) to RGB rows."""
    if len(data) < 100:
        raise ValueError("xwd output too short")
    fields = struct.unpack(">25I", data[:100])
    header_size, _version, pixmap_format, _depth, width, height = fields[:6]
    byte_order = fields[7]
    bits_per_pixel, bytes_per_line, visual_class = fields[11], fields[12], fields[13]
    red_mask, green_mask, blue_mask = fields[14], fields[15], fields[16]
    ncolors = fields[19]
    if pixmap_format != 2 or bits_per_pixel not in (24, 32) or width == 0:
        raise ValueError(f"unsupported xwd format {pixmap_format}/{bits_per_pixel}bpp")
    # bits_per_pixel is the pixel size; bytes_per_line is only the row stride.
    # Debian 13's xwd against Xtigervnc writes packed 3-byte pixels in rows
    # padded to width * 4, so the stride must never decide the pixel size.
    pixel_bytes = bits_per_pixel // 8
    colormap = data[header_size:header_size + ncolors * 12]
    offset = header_size + ncolors * 12
    pixels = data[offset:offset + bytes_per_line * height]
    if len(pixels) < bytes_per_line * height or bytes_per_line < width * pixel_bytes:
        raise ValueError("xwd pixel data truncated")

    def shift_of(mask):
        return (mask & -mask).bit_length() - 1

    def byte_index(mask):
        index = shift_of(mask) // 8
        return index if byte_order == 0 else pixel_bytes - 1 - index

    ri, gi, bi = byte_index(red_mask), byte_index(green_mask), byte_index(blue_mask)
    row_bytes = width * pixel_bytes
    if bytes_per_line != row_bytes:
        pixels = b"".join(pixels[row * bytes_per_line:row * bytes_per_line + row_bytes] for row in range(height))
    rgb = bytearray(width * height * 3)
    rgb[0::3] = pixels[ri::pixel_bytes]
    rgb[1::3] = pixels[gi::pixel_bytes]
    rgb[2::3] = pixels[bi::pixel_bytes]
    if visual_class == DIRECT_COLOR and len(colormap) == ncolors * 12:
        # DirectColor pixels index a per-channel colormap (Xtigervnc's default
        # visual); it is usually the identity ramp, but honour it when it isn't.
        tables = [bytearray(range(256)) for _ in range(3)]
        for entry in range(ncolors):
            pixel, red, green, blue = struct.unpack(">IHHH", colormap[entry * 12:entry * 12 + 10])
            for table, mask, value in zip(tables, (red_mask, green_mask, blue_mask), (red, green, blue)):
                index = (pixel & mask) >> shift_of(mask)
                if index < 256:
                    table[index] = value >> 8
        rgb[0::3] = bytes(rgb[0::3]).translate(tables[0])
        rgb[1::3] = bytes(rgb[1::3]).translate(tables[1])
        rgb[2::3] = bytes(rgb[2::3]).translate(tables[2])
    return width, height, bytes(rgb)


def encode_png(width, height, rgb):
    stride = width * 3
    raw = b"".join(b"\x00" + rgb[row * stride:(row + 1) * stride] for row in range(height))

    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    return b"".join([
        b"\x89PNG\r\n\x1a\n",
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(raw, 6)),
        chunk(b"IEND", b""),
    ])


def clip_region(region, screen):
    """Clip an {x, y, width, height} region to the screen; None if nothing is left."""
    width, height = screen
    x0, y0 = max(0, region["x"]), max(0, region["y"])
    x1, y1 = min(width, region["x"] + region["width"]), min(height, region["y"] + region["height"])
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def crop_rgb(rgb, width, region):
    stride = width * 3
    left, right = region["x"] * 3, (region["x"] + region["width"]) * 3
    return b"".join(rgb[row * stride + left:row * stride + right] for row in range(region["y"], region["y"] + region["height"]))


def zoom_scale(region, screen):
    """Largest whole-number enlargement (at most 4x) that still fits the screen size."""
    return max(1, min(MAX_ZOOM, screen[0] // region["width"], screen[1] // region["height"]))


def scale_rgb(rgb, width, height, scale):
    """Nearest-neighbour enlargement, so every screen pixel stays a crisp scale x scale block."""
    if scale == 1:
        return rgb
    stride = width * 3
    rows = []
    for row in range(height):
        line = rgb[row * stride:(row + 1) * stride]
        wide = b"".join(line[i:i + 3] * scale for i in range(0, stride, 3))
        rows.append(wide * scale)
    return b"".join(rows)


def parse_region(params, screen):
    """Read x/y/width/height query parameters into a validated, clipped region."""
    try:
        region = {name: int(params[name][0]) for name in ("x", "y", "width", "height")}
    except (KeyError, ValueError, IndexError):
        raise ActionError("a region needs whole-number x, y, width and height") from None
    if region["width"] < 1 or region["height"] < 1:
        raise ActionError("region width and height must be at least 1")
    clipped = clip_region(region, screen)
    if clipped is None:
        raise ActionError("region is outside the screen")
    return clipped


def parse_window_list(output):
    """Parse `wmctrl -lp` lines: <id> <desktop> <pid> <host> <title...>.

    Windows on every desktop (desktop -1) are the desktop shell itself, such as the
    XFCE panel and the xfdesktop background, not applications, so they are left out
    and can never be closed or moved through desktop_windows."""
    windows = []
    for line in output.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4 or not WINDOW_ID.match(parts[0]) or parts[1] == "-1":
            continue
        pid = int(parts[2]) if parts[2].isdigit() and parts[2] != "0" else None
        windows.append({"id": parts[0].lower(), "title": parts[4] if len(parts) > 4 else "", "pid": pid})
    return windows


def plan_window_action(body, windows, screen):
    """Validate a desktop_windows action and translate it into wmctrl argument vectors."""
    action = body.get("action")
    if action not in WINDOW_ACTIONS:
        raise ActionError("action must be one of focus, close, move, maximize, restore")
    window_id = body.get("windowId")
    if not isinstance(window_id, str) or window_id.lower() not in {window["id"] for window in windows}:
        raise ActionError("windowId must be the id of a window from the current list")
    window_id = window_id.lower()
    unmaximize = ["wmctrl", "-i", "-r", window_id, "-b", "remove,maximized_vert,maximized_horz"]
    if action == "focus":
        return [["wmctrl", "-i", "-a", window_id]]
    if action == "close":
        return [["wmctrl", "-i", "-c", window_id]]
    if action == "maximize":
        return [["wmctrl", "-i", "-r", window_id, "-b", "add,maximized_vert,maximized_horz"]]
    if action == "restore":
        return [unmaximize]
    width, height = screen
    limits = {"x": (0, width - 1), "y": (0, height - 1), "width": (1, width), "height": (1, height)}
    values = {name: (_int(body, name, *limits[name]) if body.get(name) is not None else -1) for name in limits}
    if all(value == -1 for value in values.values()):
        raise ActionError("move needs at least one of x, y, width or height")
    geometry = ",".join(str(values[name]) for name in ("x", "y", "width", "height"))
    return [unmaximize, ["wmctrl", "-i", "-r", window_id, "-e", f"0,{geometry}"]]


# ---------------------------------------------------------------- desktop


class Desktop:
    def __init__(self, display, launcher):
        self.display = display
        self.launcher = launcher
        self.lock = asyncio.Lock()
        self.env = dict(os.environ, DISPLAY=display)

    async def run(self, argv, timeout=COMMAND_TIMEOUT_SEC):
        process = await asyncio.create_subprocess_exec(
            *argv, env=self.env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError) as failure:
            if process.returncode is None:
                process.kill()
            await process.wait()
            if isinstance(failure, asyncio.CancelledError):
                raise
            raise RuntimeError(f"{argv[0]} timed out")
        if process.returncode != 0:
            raise RuntimeError(f"{argv[0]} failed: {stderr.decode('utf-8', 'replace').strip()[:300]}")
        return stdout

    async def text(self, argv):
        try:
            return (await self.run(argv, 5)).decode("utf-8", "replace").strip()
        except Exception:
            return ""

    async def screen_size(self):
        parts = (await self.text(["xdotool", "getdisplaygeometry"])).split()
        if len(parts) == 2 and all(part.isdigit() for part in parts):
            return int(parts[0]), int(parts[1])
        return 1280, 800

    async def launch(self, args):
        # Detached: the window outlives this request.
        await asyncio.create_subprocess_exec(
            self.launcher, *args, env=self.env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True,
        )

    async def shell_values(self, argv):
        values = {}
        for line in (await self.text(argv)).splitlines():
            key, _, value = line.partition("=")
            if value.lstrip("-").isdigit():
                values[key] = int(value)
        return values

    async def pointer(self):
        location = await self.shell_values(["xdotool", "getmouselocation", "--shell"])
        return (location["X"], location["Y"]) if "X" in location and "Y" in location else None

    async def move_pointer(self, x, y):
        if await self.pointer() == (x, y):
            return
        await self.run(["xdotool", "mousemove", "--sync", str(x), str(y)])

    async def windows(self):
        """Top-level application windows: the window manager's client list, with geometry and focus."""
        if not shutil.which("wmctrl", path=self.env.get("PATH")):
            raise RuntimeError("wmctrl is not installed on this desktop; the machine needs to be rebootstrapped")
        windows = parse_window_list((await self.run(["wmctrl", "-lp"])).decode("utf-8", "replace"))
        active = (await self.text(["xdotool", "getactivewindow"])).strip()
        active_id = hex(int(active)) if active.isdigit() else None
        for window in windows:
            # Window-manager geometry from wmctrl is frame-relative; xdotool reports
            # the client's absolute position, which is what clicks and crops need.
            geometry = await self.shell_values(["xdotool", "getwindowgeometry", "--shell", str(int(window["id"], 16))])
            window["x"], window["y"] = geometry.get("X", 0), geometry.get("Y", 0)
            window["width"], window["height"] = geometry.get("WIDTH", 0), geometry.get("HEIGHT", 0)
            window["focused"] = window["id"] == active_id
        return windows

    async def window_action(self, body):
        async with self.lock:
            commands = plan_window_action(body, await self.windows(), await self.screen_size())
            for argv in commands:
                await self.run(argv)
            await asyncio.sleep(SETTLE_SEC)
            return {"ok": True, "windows": await self.windows()}

    async def screenshot(self, window_id=None, region=None):
        """Whole screen by default; one window by id; or a region enlarged to be readable."""
        dump = await self.run(["xwd", "-root", "-silent", "-display", self.display])
        screen_width, screen_height, rgb = xwd_to_rgb(dump)
        screen = (screen_width, screen_height)
        result = {"screenWidth": screen_width, "screenHeight": screen_height}
        crop, scale = None, 1
        if window_id is not None:
            match = next((window for window in await self.windows() if window["id"] == window_id.lower()), None)
            if match is None:
                raise ActionError("window must be the id of a window from desktop_windows")
            crop = clip_region(match, screen)
            if crop is None:
                raise ActionError("that window is not on screen (it may be minimized)")
            result["window"] = {"id": match["id"], "title": match["title"]}
        elif region is not None:
            crop = region
            scale = zoom_scale(crop, screen)
        if crop is None:
            width, height = screen
        else:
            rgb = scale_rgb(crop_rgb(rgb, screen_width, crop), crop["width"], crop["height"], scale)
            width, height = crop["width"] * scale, crop["height"] * scale
            result["origin"] = {"x": crop["x"], "y": crop["y"]}
            result["scale"] = scale
        pointer = await self.pointer()
        title = await self.text(["xdotool", "getactivewindow", "getwindowname"])
        result.update({
            "width": width,
            "height": height,
            "cursor": {"x": pointer[0], "y": pointer[1]} if pointer else None,
            "activeWindow": title or None,
            "png": base64.b64encode(encode_png(width, height, rgb)).decode("ascii"),
        })
        return result

    async def act(self, actions, want_screenshot):
        async with self.lock:
            screen = await self.screen_size()
            steps = plan_actions(actions, screen)
            completed = 0
            error = None
            for group in steps:
                try:
                    for kind, value in group:
                        if kind == "xdotool":
                            await self.run(["xdotool", *value])
                        elif kind == "move":
                            await self.move_pointer(*value)
                        elif kind == "sleep":
                            await asyncio.sleep(value)
                        elif kind == "launch":
                            await self.launch(value)
                except Exception as failure:  # report progress, keep the screenshot
                    error = f"actions[{completed}]: {failure}"
                    break
                completed += 1
            result = {"ok": error is None, "completed": completed, "total": len(steps)}
            if error:
                result["error"] = error
            if want_screenshot:
                await asyncio.sleep(SETTLE_SEC)
                result["screenshot"] = await self.screenshot()
            return result


# ---------------------------------------------------------------- HTTP


def http_response(status, payload):
    body = json.dumps(payload).encode("utf-8")
    reason = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large", 500: "Internal Server Error", 502: "Bad Gateway"}.get(status, "OK")
    head = (
        f"HTTP/1.1 {status} {reason}\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Cache-Control: no-store\r\n"
        "Connection: close\r\n\r\n"
    )
    return head.encode("ascii") + body


def parse_head(head):
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) < 3:
        raise ValueError("bad request line")
    headers = {}
    for line in lines[1:]:
        name, sep, value = line.partition(":")
        if sep:
            headers[name.strip().lower()] = value.strip()
    return parts[0].upper(), parts[1], headers


async def read_json_body(headers, reader):
    length = int(headers.get("content-length", "0") or "0")
    if length <= 0:
        raise ActionError("a JSON body is required")
    if length > MAX_BODY_BYTES:
        raise PayloadTooLarge()
    body = json.loads((await reader.readexactly(length)).decode("utf-8"))
    if not isinstance(body, dict):
        raise ActionError("body must be a JSON object")
    return body


class PayloadTooLarge(Exception):
    pass


async def execution_action(reader, headers, operation):
    # The private MCP client keeps its request open. Losing that client cancels
    # queued/in-flight native input before the shared desktop lock transfers.
    if headers.get("x-terminay-execution") != "1":
        return await operation
    task = asyncio.create_task(operation)
    disconnected = asyncio.create_task(reader.read(1))
    try:
        done, _ = await asyncio.wait((task, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return await task
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise asyncio.CancelledError()
    finally:
        disconnected.cancel()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, disconnected, return_exceptions=True)


async def handle_desktop(desktop, method, path, headers, reader):
    route, _, query = path.partition("?")
    route = route[len(PREFIX):]
    params = urllib.parse.parse_qs(query)
    try:
        if route == "health" and method == "GET":
            return http_response(200, {"ok": True})
        if route == "screenshot" and method == "GET":
            async with desktop.lock:
                window_id = params.get("window", [None])[0]
                region = None
                if window_id is None and any(name in params for name in ("x", "y", "width", "height")):
                    region = parse_region(params, await desktop.screen_size())
                return http_response(200, await desktop.screenshot(window_id=window_id, region=region))
        if route == "act" and method == "POST":
            body = await read_json_body(headers, reader)
            result = await execution_action(reader, headers, desktop.act(body.get("actions"), body.get("screenshot", True) is not False))
            return http_response(200, result)
        if route == "windows" and method == "GET":
            async with desktop.lock:
                return http_response(200, {"ok": True, "windows": await desktop.windows()})
        if route == "windows" and method == "POST":
            body = await read_json_body(headers, reader)
            return http_response(200, await execution_action(reader, headers, desktop.window_action(body)))
        if route in ("health", "screenshot", "act", "windows"):
            return http_response(405, {"error": "method not allowed"})
        return http_response(404, {"error": "not found"})
    except ActionError as error:
        return http_response(400, {"error": str(error)})
    except PayloadTooLarge:
        return http_response(413, {"error": "request body too large"})
    except (ValueError, json.JSONDecodeError) as error:
        return http_response(400, {"error": f"invalid request: {error}"})
    except Exception as error:  # noqa: BLE001 - surface the failure to the agent
        return http_response(500, {"error": str(error)})


async def pipe(reader, writer):
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle_connection(desktop, cdp_port, reader, writer):
    try:
        head = await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
        writer.close()
        return
    try:
        method, path, headers = parse_head(head)
    except ValueError:
        writer.write(http_response(400, {"error": "bad request"}))
        await writer.drain()
        writer.close()
        return

    if path.startswith(PREFIX):
        try:
            response = await handle_desktop(desktop, method, path, headers, reader)
        except asyncio.CancelledError:
            writer.close()
            return
        try:
            writer.write(response)
            await writer.drain()
        finally:
            writer.close()
        return

    # Everything else is Chromium's CDP (HTTP discovery and WebSocket upgrades):
    # replay the request head and splice the two sockets together.
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection("127.0.0.1", cdp_port)
    except OSError:
        writer.write(http_response(502, {"error": "browser CDP is not available"}))
        await writer.drain()
        writer.close()
        return
    upstream_writer.write(head)
    await asyncio.gather(pipe(reader, upstream_writer), pipe(upstream_reader, writer))


async def serve(args):
    desktop = Desktop(args.display, args.launcher)
    server = await asyncio.start_server(
        lambda r, w: handle_connection(desktop, args.cdp_port, r, w),
        host=args.host, port=args.listen_port, limit=MAX_HEADER_BYTES,
    )
    async with server:
        await server.serve_forever()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--cdp-port", type=int, default=9222)
    parser.add_argument("--display", default=os.environ.get("DISPLAY", ":1"))
    parser.add_argument("--launcher", required=True)
    args = parser.parse_args(argv)
    print(f"terminay-desktop-control listening on {args.host}:{args.listen_port} (cdp {args.cdp_port}, display {args.display}) at {time.strftime('%Y-%m-%dT%H:%M:%S')}", file=sys.stderr, flush=True)
    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
