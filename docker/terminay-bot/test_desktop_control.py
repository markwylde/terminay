import asyncio
import importlib.util
import json
import os
import struct
import sys
sys.dont_write_bytecode = True
import unittest
import zlib

_spec = importlib.util.spec_from_file_location(
    "terminay_desktop_control", os.path.join(os.path.dirname(__file__), "bin/terminay-desktop-control.py")
)
control = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(control)

SCREEN = (1280, 800)


def xdotool_args(steps):
    return [value for group in steps for kind, value in group if kind == "xdotool"]


def step_kinds(steps):
    return [(kind, value) for group in steps for kind, value in group if kind in ("xdotool", "move")]


class PlanActionsTest(unittest.TestCase):
    def test_click_moves_then_clicks(self):
        steps = control.plan_actions([{"type": "click", "x": 10.4, "y": 20}], SCREEN)
        self.assertEqual(step_kinds(steps), [
            ("move", (10, 20)),
            ("xdotool", ["click", "--repeat", "1", "--delay", "80", "1"]),
        ])

    def test_click_without_point_clicks_in_place(self):
        steps = control.plan_actions([{"type": "click", "button": "right", "count": 2}], SCREEN)
        self.assertEqual(xdotool_args(steps), [["click", "--repeat", "2", "--delay", "80", "3"]])

    def test_double_and_right_click(self):
        steps = control.plan_actions([
            {"type": "double_click", "x": 1, "y": 1},
            {"type": "right_click", "x": 2, "y": 2},
        ], SCREEN)
        clicks = [args for args in xdotool_args(steps) if args[0] == "click"]
        self.assertEqual(clicks, [
            ["click", "--repeat", "2", "--delay", "80", "1"],
            ["click", "--repeat", "1", "--delay", "80", "3"],
        ])

    def test_type_passes_text_as_single_argument(self):
        text = "hello; rm -rf / $(whoami)\n"
        steps = control.plan_actions([{"type": "type", "text": text}], SCREEN)
        self.assertEqual(xdotool_args(steps), [["type", "--delay", "12", "--", text]])

    def test_key_accepts_combos_and_sequences(self):
        steps = control.plan_actions([{"type": "key", "keys": "ctrl+shift+t Return"}], SCREEN)
        self.assertEqual(xdotool_args(steps), [["key", "--delay", "40", "--", "ctrl+shift+t", "Return"]])

    def test_key_rejects_shell_like_input(self):
        for keys in ["ctrl+l; rm", "$(id)", "a b|c", "--help", "ctrl+"]:
            with self.assertRaises(control.ActionError, msg=keys):
                control.plan_actions([{"type": "key", "keys": keys}], SCREEN)

    def test_coordinates_must_be_on_screen(self):
        with self.assertRaisesRegex(control.ActionError, r"actions\[1\]: x must be between 0 and 1279"):
            control.plan_actions([{"type": "move", "x": 1, "y": 1}, {"type": "move", "x": 1280, "y": 1}], SCREEN)
        with self.assertRaises(control.ActionError):
            control.plan_actions([{"type": "move", "x": True, "y": 1}], SCREEN)

    def test_scroll_and_drag(self):
        steps = control.plan_actions([
            {"type": "scroll", "x": 5, "y": 6, "direction": "down", "amount": 4},
            {"type": "drag", "fromX": 0, "fromY": 0, "toX": 100, "toY": 50},
        ], SCREEN)
        args = xdotool_args(steps)
        self.assertIn(["click", "--repeat", "4", "--delay", "40", "5"], args)
        self.assertIn(["mousedown", "1"], args)
        self.assertEqual(args[-1], ["mouseup", "1"])
        moves = [value for kind, value in step_kinds(steps) if kind == "move"]
        self.assertEqual(moves[0], (5, 6))
        self.assertEqual(moves[1], (0, 0))
        self.assertEqual(moves[-1], (100, 50))
        self.assertNotIn("mousemove", [arg[0] for arg in args])

    def test_waits_are_bounded(self):
        with self.assertRaises(control.ActionError):
            control.plan_actions([{"type": "wait", "ms": 10001}], SCREEN)
        with self.assertRaisesRegex(control.ActionError, "waits may total"):
            control.plan_actions([{"type": "wait", "ms": 10000}] * 4, SCREEN)

    def test_launch_only_known_apps_and_safe_urls(self):
        steps = control.plan_actions([{"type": "launch", "app": "browser", "url": "https://example.com"}], SCREEN)
        self.assertEqual(steps[0][0], ("launch", ["browser", "https://example.com"]))
        for action in [
            {"type": "launch", "app": "bash"},
            {"type": "launch", "app": "browser", "url": "javascript:alert(1)"},
            {"type": "launch", "app": "terminal", "url": "https://example.com"},
        ]:
            with self.assertRaises(control.ActionError):
                control.plan_actions([action], SCREEN)

    def test_batch_limits(self):
        with self.assertRaises(control.ActionError):
            control.plan_actions([], SCREEN)
        with self.assertRaises(control.ActionError):
            control.plan_actions([{"type": "wait", "ms": 0}] * 51, SCREEN)
        with self.assertRaises(control.ActionError):
            control.plan_actions([{"type": "type", "text": "x" * 5001}], SCREEN)
        with self.assertRaisesRegex(control.ActionError, "type must be one of"):
            control.plan_actions([{"type": "exec", "cmd": "id"}], SCREEN)


def xwd_dump(width, height, pixels, byte_order=0, pad=0, ncolors=2, bits_per_pixel=32, pixel_bytes=4,
             visual_class=4, colormap=None):
    name = b"root\x00"
    header_size = 100 + len(name)
    bytes_per_line = width * pixel_bytes + pad
    if colormap is not None:
        ncolors = len(colormap)
    fields = [
        header_size, 7, 2, 24, width, height, 0, byte_order, 32, byte_order, 32, bits_per_pixel,
        bytes_per_line, visual_class, 0xFF0000, 0x00FF00, 0x0000FF, 8, 256, ncolors, width, height, 0, 0, 0,
    ]
    if colormap is None:
        colors = b"\x00" * (12 * ncolors)
    else:
        colors = b"".join(struct.pack(">IHHHBB", pixel, r, g, b, 7, 0) for pixel, r, g, b in colormap)
    rows = []
    for y in range(height):
        row = b""
        for x in range(width):
            r, g, b = pixels[y * width + x]
            value = (r << 16) | (g << 8) | b
            packed = struct.pack("<I" if byte_order == 0 else ">I", value)
            row += (packed[:pixel_bytes] if byte_order == 0 else packed[4 - pixel_bytes:])
        rows.append(row + b"\x00" * pad)
    return struct.pack(">25I", *fields) + name + colors + b"".join(rows)


class ScreenshotTest(unittest.TestCase):
    PIXELS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (10, 20, 30), (200, 100, 50), (1, 2, 3)]

    def expected(self):
        return bytes(channel for pixel in self.PIXELS for channel in pixel)

    def test_decodes_lsb_first_dump(self):
        width, height, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS))
        self.assertEqual((width, height), (3, 2))
        self.assertEqual(rgb, self.expected())

    def test_decodes_msb_first_dump_with_row_padding(self):
        _, _, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS, byte_order=1, pad=4))
        self.assertEqual(rgb, self.expected())

    def test_decodes_packed_24bpp_rows_padded_to_32bpp_width(self):
        # Debian 13's xwd against Xtigervnc: 3-byte pixels, bytes_per_line = width * 4.
        # Reading them as 4-byte pixels squashes the screen to 75% width and stripes colour.
        _, _, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS, bits_per_pixel=24, pixel_bytes=3, pad=3, visual_class=5, ncolors=0))
        self.assertEqual(rgb, self.expected())

    def test_decodes_packed_24bpp_dump(self):
        _, _, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS, bits_per_pixel=24, pixel_bytes=3, pad=2))
        self.assertEqual(rgb, self.expected())
        _, _, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS, byte_order=1, bits_per_pixel=24, pixel_bytes=3))
        self.assertEqual(rgb, self.expected())

    def test_applies_a_direct_color_colormap(self):
        # Identity ramp except channel value 255 maps to 128 (16-bit colormap values).
        ramp = [(value << 16 | value << 8 | value, value * 257, value * 257, value * 257) for value in range(256)]
        ramp[255] = (0xFFFFFF, 128 * 257, 128 * 257, 128 * 257)
        _, _, rgb = control.xwd_to_rgb(xwd_dump(3, 2, self.PIXELS, bits_per_pixel=24, pixel_bytes=3, visual_class=5, colormap=ramp))
        expected = bytes(128 if channel == 255 else channel for channel in self.expected())
        self.assertEqual(rgb, expected)

    def test_encodes_a_valid_png(self):
        png = control.encode_png(3, 2, self.expected())
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        width, height = struct.unpack(">II", png[16:24])
        self.assertEqual((width, height), (3, 2))
        idat_length = struct.unpack(">I", png[33:37])[0]
        raw = zlib.decompress(png[41:41 + idat_length])
        self.assertEqual(raw, b"\x00" + self.expected()[:9] + b"\x00" + self.expected()[9:])

    def test_rejects_unsupported_formats(self):
        dump = bytearray(xwd_dump(1, 1, [(0, 0, 0)]))
        dump[44:48] = struct.pack(">I", 16)  # bits_per_pixel
        with self.assertRaises(ValueError):
            control.xwd_to_rgb(bytes(dump))


class FakeDesktop(control.Desktop):
    """Desktop whose commands are recorded instead of run."""

    def __init__(self, pointer):
        super().__init__(":99", "/bin/true")
        self.current = pointer
        self.commands = []

    async def run(self, argv, timeout=control.COMMAND_TIMEOUT_SEC):
        self.commands.append(argv)
        if argv[:2] == ["xdotool", "mousemove"]:
            self.current = (int(argv[-2]), int(argv[-1]))
        return b""

    async def pointer(self):
        return self.current

    async def screen_size(self):
        return SCREEN


class PointerMoveTest(unittest.IsolatedAsyncioTestCase):
    async def test_skips_a_move_to_the_current_position(self):
        # `mousemove --sync` to where the pointer already is never returns.
        desktop = FakeDesktop((900, 560))
        await desktop.act([{"type": "drag", "fromX": 900, "fromY": 560, "toX": 970, "toY": 520}], False)
        moves = [argv for argv in desktop.commands if argv[:2] == ["xdotool", "mousemove"]]
        self.assertNotIn(["xdotool", "mousemove", "--sync", "900", "560"], moves)
        self.assertEqual(moves[-1], ["xdotool", "mousemove", "--sync", "970", "520"])

    async def test_moves_when_the_pointer_is_elsewhere(self):
        desktop = FakeDesktop((0, 0))
        result = await desktop.act([{"type": "click", "x": 10, "y": 20}], False)
        self.assertTrue(result["ok"])
        self.assertEqual(desktop.commands[0], ["xdotool", "mousemove", "--sync", "10", "20"])


WMCTRL_OUTPUT = """0x01800003  0 412    bird-b48ef2ca Untitled \u2014 KolourPaint
0x00e00004 -1 0      bird-b48ef2ca
0x00200003 -1 32     bird-b48ef2ca xfce4-panel
0x00a00002  0 0      bird-b48ef2ca
0x01200003  0 380    N/A vms@bird: ~
garbage line
"""


class WindowsTest(unittest.TestCase):
    def test_parses_wmctrl_client_list(self):
        windows = control.parse_window_list(WMCTRL_OUTPUT)
        self.assertEqual(windows, [
            {"id": "0x01800003", "title": "Untitled \u2014 KolourPaint", "pid": 412},
            {"id": "0x00a00002", "title": "", "pid": None},
            {"id": "0x01200003", "title": "vms@bird: ~", "pid": 380},
        ])

    def test_plans_window_actions_for_listed_windows_only(self):
        windows = control.parse_window_list(WMCTRL_OUTPUT)
        self.assertEqual(control.plan_window_action({"action": "focus", "windowId": "0x01800003"}, windows, SCREEN),
                         [["wmctrl", "-i", "-a", "0x01800003"]])
        self.assertEqual(control.plan_window_action({"action": "close", "windowId": "0X01800003"}, windows, SCREEN),
                         [["wmctrl", "-i", "-c", "0x01800003"]])
        move = control.plan_window_action({"action": "move", "windowId": "0x01800003", "x": 0, "y": 0, "width": 640}, windows, SCREEN)
        self.assertEqual(move[-1], ["wmctrl", "-i", "-r", "0x01800003", "-e", "0,0,0,640,-1"])
        with self.assertRaisesRegex(control.ActionError, "windowId must be"):
            control.plan_window_action({"action": "focus", "windowId": "0x0badbeef"}, windows, SCREEN)
        with self.assertRaisesRegex(control.ActionError, "action must be"):
            control.plan_window_action({"action": "kill", "windowId": "0x01800003"}, windows, SCREEN)
        with self.assertRaisesRegex(control.ActionError, "move needs"):
            control.plan_window_action({"action": "move", "windowId": "0x01800003"}, windows, SCREEN)
        with self.assertRaises(control.ActionError):
            control.plan_window_action({"action": "move", "windowId": "0x01800003", "x": 5000}, windows, SCREEN)


class CropAndZoomTest(unittest.TestCase):
    # 4x2 image; each pixel's red channel is its index.
    RGB = bytes(channel for index in range(8) for channel in (index, 0, 0))

    def test_crops_a_region(self):
        crop = control.crop_rgb(self.RGB, 4, {"x": 1, "y": 0, "width": 2, "height": 2})
        self.assertEqual(crop[0::3], bytes([1, 2, 5, 6]))

    def test_clips_regions_to_the_screen(self):
        self.assertEqual(control.clip_region({"x": -10, "y": 790, "width": 50, "height": 50}, SCREEN),
                         {"x": 0, "y": 790, "width": 40, "height": 10})
        self.assertIsNone(control.clip_region({"x": 1300, "y": 0, "width": 10, "height": 10}, SCREEN))

    def test_zoom_scale_fits_the_screen_and_caps_at_4x(self):
        self.assertEqual(control.zoom_scale({"x": 0, "y": 0, "width": 100, "height": 50}, SCREEN), 4)
        self.assertEqual(control.zoom_scale({"x": 0, "y": 0, "width": 500, "height": 300}, SCREEN), 2)
        self.assertEqual(control.zoom_scale({"x": 0, "y": 0, "width": 1000, "height": 100}, SCREEN), 1)

    def test_scales_with_nearest_neighbour_blocks(self):
        scaled = control.scale_rgb(bytes([1, 0, 0, 2, 0, 0]), 2, 1, 2)
        self.assertEqual(scaled[0::3], bytes([1, 1, 2, 2, 1, 1, 2, 2]))

    def test_parses_and_validates_region_parameters(self):
        self.assertEqual(control.parse_region({"x": ["10"], "y": ["20"], "width": ["30"], "height": ["40"]}, SCREEN),
                         {"x": 10, "y": 20, "width": 30, "height": 40})
        for params in [{"x": ["1"]}, {"x": ["a"], "y": ["0"], "width": ["1"], "height": ["1"]},
                       {"x": ["0"], "y": ["0"], "width": ["0"], "height": ["1"]},
                       {"x": ["2000"], "y": ["0"], "width": ["5"], "height": ["5"]}]:
            with self.assertRaises(control.ActionError, msg=params):
                control.parse_region(params, SCREEN)


class RouterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cdp_requests = []

        async def fake_cdp(reader, writer):
            head = await reader.readuntil(b"\r\n\r\n")
            self.cdp_requests.append(head.split(b"\r\n", 1)[0].decode())
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            await writer.drain()
            writer.close()

        self.cdp = await asyncio.start_server(fake_cdp, "127.0.0.1", 0)
        cdp_port = self.cdp.sockets[0].getsockname()[1]
        desktop = control.Desktop(":99", "/bin/true")
        self.router = await asyncio.start_server(
            lambda r, w: control.handle_connection(desktop, cdp_port, r, w), "127.0.0.1", 0
        )
        self.port = self.router.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.router.close()
        self.cdp.close()
        await self.router.wait_closed()
        await self.cdp.wait_closed()

    async def request(self, raw):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        writer.write(raw)
        await writer.drain()
        data = await reader.read()
        writer.close()
        return data

    async def test_forwards_non_desktop_requests_to_cdp(self):
        response = await self.request(b"GET /json/version HTTP/1.1\r\nHost: x\r\n\r\n")
        self.assertTrue(response.endswith(b"ok"))
        self.assertEqual(self.cdp_requests, ["GET /json/version HTTP/1.1"])

    async def test_answers_desktop_health_locally(self):
        response = await self.request(b"GET /terminay-desktop/health HTTP/1.1\r\nHost: x\r\n\r\n")
        self.assertIn(b"200 OK", response)
        self.assertEqual(json.loads(response.split(b"\r\n\r\n", 1)[1]), {"ok": True})
        self.assertEqual(self.cdp_requests, [])

    async def test_rejects_invalid_actions_before_touching_the_display(self):
        body = json.dumps({"actions": [{"type": "key", "keys": "$(id)"}]}).encode()
        original = control.Desktop.screen_size

        async def fixed_size(_self):
            return SCREEN

        control.Desktop.screen_size = fixed_size
        try:
            response = await self.request(
                b"POST /terminay-desktop/act HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\n\r\n".encode() + body
            )
        finally:
            control.Desktop.screen_size = original
        self.assertIn(b"400 Bad Request", response)
        self.assertIn(b"actions[0]: keys must be", response)


class ExecutionDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_input_cancels_when_its_execution_disconnects(self):
        started, cancelled = asyncio.Event(), asyncio.Event()
        class Desktop:
            async def act(self, actions, screenshot):
                started.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
        server = await asyncio.start_server(lambda r, w: control.handle_connection(Desktop(), 1, r, w), "127.0.0.1", 0)
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
            body = b'{"actions":[]}'
            writer.write(b"POST /terminay-desktop/act HTTP/1.1\r\nHost: x\r\nx-terminay-execution: 1\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
            await writer.drain()
            await asyncio.wait_for(started.wait(), 1)
            writer.close()
            await writer.wait_closed()
            await asyncio.wait_for(cancelled.wait(), 1)
        finally:
            server.close()
            await server.wait_closed()

if __name__ == "__main__":
    unittest.main()
