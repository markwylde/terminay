import test from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOP_HOST_BRIDGE_VERSION,
  DesktopHostBridgeRouter,
  createDesktopPreloadBridge,
  validateDesktopHostAction,
} from "../dist/index.js";

test("versioned bridge validates source, current connection, and user gesture", async () => {
  const calls = [];
  const router = new DesktopHostBridgeRouter();
  router.register({
    sourceId: "source-a",
    context: { version: DESKTOP_HOST_BRIDGE_VERSION, windowId: "window-a", connectionId: "local:one", profileLabel: "Local", capabilities: { nativeWindows: true, clipboard: true } },
    handlers: { clipboardWrite: (request) => calls.push(request.text) },
  });
  const base = { version: DESKTOP_HOST_BRIDGE_VERSION, sourceId: "source-a", windowId: "window-a", connectionId: "local:one" };
  await router.request({ ...base, userGesture: true, action: { type: "clipboard.write", text: "ok" } });
  assert.deepEqual(calls, ["ok"]);
  await assert.rejects(router.request({ ...base, userGesture: false, action: { type: "clipboard.write", text: "no" } }), /user gesture/);
  await assert.rejects(router.request({ ...base, userGesture: true, connectionId: "remote:two", action: { type: "clipboard.write", text: "no" } }), /bound window or connection/);
  await assert.rejects(router.request({ ...base, userGesture: true, action: { type: "window.open", profileId: "remote:two" } }), /different connection/);
  const noClipboard = new DesktopHostBridgeRouter();
  noClipboard.register({ sourceId: "source-b", context: { version: 1, windowId: "window-b", connectionId: "local:one", profileLabel: "Local", capabilities: {} }, handlers: {} });
  await assert.rejects(noClipboard.request({ ...base, sourceId: "source-b", windowId: "window-b", userGesture: true, action: { type: "clipboard.read" } }), /clipboard/);
  assert.throws(() => validateDesktopHostAction({ type: "external.open", url: "http://evil.example", extra: true }), /invalid/);
  assert.throws(() => validateDesktopHostAction({ type: "clipboard.write", text: "ok", secret: "forbidden" }), /invalid/);
});

test("preload facade exposes only validated action calls", async () => {
  const invocations = [];
  const bridge = createDesktopPreloadBridge({
    invoke: async (channel, payload) => {
      invocations.push({ channel, payload });
      if (channel.endsWith("get-context")) return { version: 1, windowId: "window-a", connectionId: "local:one", profileLabel: "Local", capabilities: { nativeWindows: true } };
      return undefined;
    },
  });
  assert.equal((await bridge.getContext()).profileLabel, "Local");
  await bridge.requestAction({ type: "clipboard.write", text: "safe" }, { userGesture: true });
  assert.equal(invocations.length, 2);
  assert.equal(invocations[1].payload.action.type, "clipboard.write");
  await assert.rejects(bridge.requestAction({ type: "clipboard.write", text: "safe", secret: "x" }), /invalid/);
});
