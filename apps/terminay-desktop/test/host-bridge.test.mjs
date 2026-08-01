import test from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOP_HOST_BRIDGE_VERSION,
  DesktopHostBridgeRouter,
  createDesktopPresentationMetadata,
  createDesktopPreloadBridge,
  createDesktopFileSelectionActionModel,
  installDesktopPreloadBridge,
  validateDesktopHostAction,
} from "../dist/index.js";

const presentation = createDesktopPresentationMetadata({
  accelerators: [{ command: "new-terminal", title: "New terminal", accelerator: "CmdOrCtrl+T" }],
  geometry: { x: 12, y: 24, width: 1200, height: 800, maximized: false },
  updater: { state: "available", currentVersion: "1.2.3", latestVersion: "1.2.4", releaseUrl: "https://github.com/markwylde/terminay/releases/tag/v1.2.4", checkedAt: "2026-07-27T12:00:00.000Z" },
  osIntegration: { externalOpen: true, reveal: true, notifications: true, nativeMenu: true, dockIcon: true },
});

test("versioned bridge validates source, current connection, and user gesture", async () => {
  const calls = [];
  const router = new DesktopHostBridgeRouter();
  router.register({
    sourceId: "source-a",
    context: { version: DESKTOP_HOST_BRIDGE_VERSION, windowId: "window-a", connectionId: "local:one", profileLabel: "Local", capabilities: { nativeWindows: true, clipboard: true, updater: true, osIntegration: true }, presentation },
    handlers: { clipboardWrite: (request) => calls.push(request.text) },
  });
  const base = { version: DESKTOP_HOST_BRIDGE_VERSION, sourceId: "source-a", windowId: "window-a", connectionId: "local:one" };
  await router.request({ ...base, userGesture: true, action: { type: "clipboard.write", text: "ok" } });
  assert.deepEqual(calls, ["ok"]);
  await assert.rejects(router.request({ ...base, userGesture: false, action: { type: "clipboard.write", text: "no" } }), /user gesture/);
  await assert.rejects(router.request({ ...base, userGesture: true, connectionId: "remote:two", action: { type: "clipboard.write", text: "no" } }), /bound window or connection/);
  await assert.rejects(router.request({ ...base, userGesture: true, action: { type: "window.open", profileId: "remote:two" } }), /different connection/);
  const noClipboard = new DesktopHostBridgeRouter();
  noClipboard.register({ sourceId: "source-b", context: { version: 1, windowId: "window-b", connectionId: "local:one", profileLabel: "Local", capabilities: {}, presentation }, handlers: {} });
  await assert.rejects(noClipboard.request({ ...base, sourceId: "source-b", windowId: "window-b", userGesture: true, action: { type: "clipboard.read" } }), /clipboard/);
  assert.throws(() => validateDesktopHostAction({ type: "external.open", url: "http://evil.example", extra: true }), /invalid/);
  assert.throws(() => validateDesktopHostAction({ type: "clipboard.write", text: "ok", secret: "forbidden" }), /invalid/);
});

test("server UI can request only host-advertised native menu commands", async () => {
  const commands = [];
  const router = new DesktopHostBridgeRouter();
  router.register({
    sourceId: "menu-source",
    context: {
      version: DESKTOP_HOST_BRIDGE_VERSION,
      windowId: "menu-window",
      connectionId: "local:menu",
      profileLabel: "Local",
      capabilities: { nativeWindows: true, osIntegration: true },
      presentation,
    },
    handlers: { menuCommand: ({ command }) => commands.push(command) },
  });
  const request = {
    version: DESKTOP_HOST_BRIDGE_VERSION,
    sourceId: "menu-source",
    windowId: "menu-window",
    connectionId: "local:menu",
    userGesture: true,
  };
  await router.request({ ...request, action: { type: "menu.command", command: "new-terminal" } });
  assert.deepEqual(commands, ["new-terminal"]);
  await assert.rejects(
    router.request({ ...request, action: { type: "menu.command", command: "delete-everything" } }),
    /not available/,
  );

  const unavailable = new DesktopHostBridgeRouter();
  unavailable.register({
    sourceId: "menu-without-native-menu",
    context: {
      version: DESKTOP_HOST_BRIDGE_VERSION,
      windowId: "menu-window-2",
      connectionId: "local:menu",
      profileLabel: "Local",
      capabilities: { nativeWindows: true, osIntegration: true },
      presentation: createDesktopPresentationMetadata({
        accelerators: [{ command: "new-terminal", title: "New terminal", accelerator: "CmdOrCtrl+T" }],
      }),
    },
    handlers: { menuCommand: ({ command }) => commands.push(command) },
  });
  await assert.rejects(
    unavailable.request({ ...request, sourceId: "menu-without-native-menu", windowId: "menu-window-2", action: { type: "menu.command", command: "new-terminal" } }),
    /native menu integration is unavailable/,
  );

  const noOsIntegration = new DesktopHostBridgeRouter();
  noOsIntegration.register({
    sourceId: "menu-without-os-integration",
    context: {
      version: DESKTOP_HOST_BRIDGE_VERSION,
      windowId: "menu-window-3",
      connectionId: "local:menu",
      profileLabel: "Local",
      capabilities: { nativeWindows: true },
      presentation,
    },
    handlers: { menuCommand: ({ command }) => commands.push(command) },
  });
  await assert.rejects(
    noOsIntegration.request({ ...request, sourceId: "menu-without-os-integration", windowId: "menu-window-3", action: { type: "menu.command", command: "new-terminal" } }),
    /osIntegration/,
  );

  const noNativeWindows = new DesktopHostBridgeRouter();
  noNativeWindows.register({
    sourceId: "menu-without-native-windows",
    context: {
      version: DESKTOP_HOST_BRIDGE_VERSION,
      windowId: "menu-window-4",
      connectionId: "local:menu",
      profileLabel: "Local",
      capabilities: { osIntegration: true },
      presentation,
    },
    handlers: { menuCommand: ({ command }) => commands.push(command) },
  });
  await assert.rejects(
    noNativeWindows.request({ ...request, sourceId: "menu-without-native-windows", windowId: "menu-window-4", action: { type: "menu.command", command: "new-terminal" } }),
    /nativeWindows/,
  );
  assert.deepEqual(commands, ["new-terminal"]);
});

test("preload facade exposes only validated action calls", async () => {
  const invocations = [];
  const bridge = createDesktopPreloadBridge({
    invoke: async (channel, payload) => {
      invocations.push({ channel, payload });
      if (channel.endsWith("get-context")) return { version: 1, windowId: "window-a", connectionId: "local:one", profileLabel: "Local", capabilities: { nativeWindows: true }, presentation };
      return undefined;
    },
  });
  assert.equal((await bridge.getContext()).profileLabel, "Local");
  await bridge.requestAction({ type: "clipboard.write", text: "safe" }, { userGesture: true });
  assert.equal(invocations.length, 2);
  assert.equal(invocations[1].payload.action.type, "clipboard.write");
  await assert.rejects(bridge.requestAction({ type: "clipboard.write", text: "safe", secret: "x" }), /invalid/);
});

test("preload projects exactly the narrow host API into the main frame", async () => {
  const calls = [];
  const bridge = {
    version: DESKTOP_HOST_BRIDGE_VERSION,
    async getContext() { return { safe: true }; },
    async requestAction(action) { calls.push(action); return "approved"; },
    readMachineSecret() { throw new Error("must never cross the preload boundary"); },
  };
  const exposed = [];
  const target = { exposeInMainWorld(name, value) { exposed.push({ name, value }); } };

  installDesktopPreloadBridge(target, bridge);
  installDesktopPreloadBridge(target, bridge, false);

  assert.equal(exposed.length, 1, "subframes must not receive host capabilities");
  assert.equal(exposed[0].name, "terminayHost");
  assert.deepEqual(Object.keys(exposed[0].value).sort(), ["getContext", "requestAction", "version"]);
  assert.equal(Object.isFrozen(exposed[0].value), true);
  assert.equal("readMachineSecret" in exposed[0].value, false);
  assert.deepEqual(await exposed[0].value.getContext(), { safe: true });
  assert.equal(await exposed[0].value.requestAction({ type: "clipboard.read" }), "approved");
  assert.deepEqual(calls, [{ type: "clipboard.read" }]);
});

test("Desktop exposes the native picker only when the host capability is bound", async () => {
  const browserFallback = createDesktopFileSelectionActionModel();
  assert.equal(browserFallback.presentation, "in-page");
  const native = createDesktopFileSelectionActionModel({ has: (capability) => capability === "filePicker", require() {}, capabilities: { filePicker: true } });
  assert.equal(native.presentation, "native-dialog");
  assert.equal(native.fallback.route, "file");
});
