import assert from "node:assert/strict";
import test from "node:test";
import { SettingsClient, createHostCapabilityProvider } from "@terminay/client-core";
import {
  DESKTOP_HOST_BRIDGE_VERSION,
  DesktopHostBridgeRouter,
  WindowViewRegistry,
  createDesktopPresentationMetadata,
  createDesktopRendererContext,
  createDesktopWorkspaceRouteRenderModel,
  normalizeDesktopPresentationMetadata,
  projectAcceleratorPresentation,
} from "../dist/index.js";

const commands = [
  { command: "new-terminal", title: "New terminal" },
  { command: "open-command-bar", title: "Command bar" },
];

function context(overrides = {}) {
  return {
    version: DESKTOP_HOST_BRIDGE_VERSION,
    windowId: "window-presentation",
    connectionId: "remote:one",
    profileLabel: "Remote",
    capabilities: { nativeWindows: true, updater: true, osIntegration: true },
    presentation: createDesktopPresentationMetadata({
      accelerators: [
        { command: "new-terminal", title: "New terminal", accelerator: "CmdOrCtrl+T" },
      ],
      geometry: { x: 20, y: 30, width: 1200, height: 800, maximized: false },
      updater: { state: "idle", currentVersion: "1.2.3" },
      osIntegration: { externalOpen: true, reveal: true, notifications: false, nativeMenu: true, dockIcon: true },
    }),
    ...overrides,
  };
}

test("shared settings project to accelerator metadata without crossing server settings", async () => {
  const settingsClient = new SettingsClient({
    query: async () => ({ keyboardShortcuts: { "new-terminal": "CmdOrCtrl+T", "open-command-bar": "CmdOrCtrl+L" }, secret: "must-not-cross" }),
  });
  const settings = await settingsClient.get();
  const accelerators = projectAcceleratorPresentation(commands, settings.keyboardShortcuts);
  const metadata = createDesktopPresentationMetadata({ accelerators });

  assert.deepEqual(metadata.accelerators, [
    { command: "new-terminal", title: "New terminal", accelerator: "CmdOrCtrl+T" },
    { command: "open-command-bar", title: "Command bar", accelerator: "CmdOrCtrl+L" },
  ]);
  assert.equal(JSON.stringify(metadata).includes("must-not-cross"), false);
  assert.equal("keyboardShortcuts" in metadata, false);
  assert.equal(Object.isFrozen(metadata), true);
});

test("Desktop renders the shared settings component as an auxiliary route when native windows are available", () => {
  const model = createDesktopWorkspaceRouteRenderModel("settings");
  assert.equal(model.presentation, "native-auxiliary");
  assert.equal(model.component.id, "shared.route.settings");
  assert.deepEqual(model.component.regions, ["settings-sections", "settings-editor"]);
});

test("Desktop shared openWindow action is capability-gated and uses the narrow native bridge", async () => {
  const invocations = [];
  const hostApi = {
    async getContext() {
      return {
        version: DESKTOP_HOST_BRIDGE_VERSION,
        windowId: "window-presentation",
        connectionId: "remote-one",
        profileLabel: "Remote",
        capabilities: { nativeWindows: true },
        presentation: createDesktopPresentationMetadata({}),
      };
    },
    async requestAction(action, options) {
      invocations.push({ action, options });
    },
  };
  const client = { snapshot: { state: "connected", revision: 8, cursor: "cursor-8", stale: false, reconnectAttempt: 0 } };

  const desktop = createDesktopRendererContext({
    client,
    hostApi,
    capabilities: createHostCapabilityProvider({ nativeWindows: true }),
  });
  await desktop.host.actions.openWindow({ serverId: "remote-one", view: "settings-view" });
  assert.deepEqual(invocations, [{
    action: { type: "window.open", profileId: "remote-one", workspaceViewId: "settings-view" },
    options: { userGesture: true },
  }]);

  const webLike = createDesktopRendererContext({ client, hostApi });
  await assert.rejects(
    webLike.host.actions.openWindow({ serverId: "remote-one", view: "settings-view" }),
    /nativeWindows/,
  );
  assert.equal(invocations.length, 1);
});

test("window geometry remains host-local and is restored independently of server state", async () => {
  let saved = [];
  const first = new WindowViewRegistry({ storage: { load: () => saved, save: (next) => { saved = next; } } });
  first.bind({ windowId: "window-presentation", connectionId: "remote:one", workspaceViewId: "view-one" });
  first.updateGeometry("window-presentation", { x: 100, y: 200, width: 1400, height: 900, maximized: true });
  await first.flush();

  const second = new WindowViewRegistry({ storage: { load: () => saved, save: () => undefined } });
  await second.load();
  assert.deepEqual(second.get("window-presentation")?.geometry, { x: 100, y: 200, width: 1400, height: 900, maximized: true });
  assert.equal(JSON.stringify(saved).includes("server"), false);
  assert.throws(() => second.updateGeometry("window-presentation", { width: 0, height: 900 }), /window width/);
});

test("updater metadata is bounded presentation state and rejects unsafe release URLs", () => {
  const metadata = createDesktopPresentationMetadata({
    updater: { state: "available", currentVersion: "1.2.3", latestVersion: "1.2.4", releaseUrl: "https://github.com/markwylde/terminay/releases/tag/v1.2.4" },
  });
  assert.equal(metadata.updater.state, "available");
  assert.throws(() => normalizeDesktopPresentationMetadata({ ...metadata, updater: { ...metadata.updater, releaseUrl: "https://user:secret@example.com/update" } }), /release URL/);
  assert.throws(() => createDesktopPresentationMetadata({ updater: { state: "available", currentVersion: "1.2.3" } }), /release metadata/);
});

test("OS integration actions are capability-gated and remain presentation-only", async () => {
  const calls = [];
  const router = new DesktopHostBridgeRouter();
  router.register({
    sourceId: "source-presentation",
    context: context(),
    handlers: {
      externalOpen: (request) => calls.push(["open", request.url]),
      reveal: (request) => calls.push(["reveal", request.fileId]),
      updateStatus: (request) => calls.push(["update", request.state]),
    },
  });
  const requestBase = { version: DESKTOP_HOST_BRIDGE_VERSION, sourceId: "source-presentation", windowId: "window-presentation", connectionId: "remote:one", userGesture: true };
  await router.request({ ...requestBase, action: { type: "external.open", url: "https://docs.example/help" } });
  await router.request({ ...requestBase, action: { type: "reveal", fileId: "file-token" } });
  await router.request({ ...requestBase, action: { type: "update.status", channel: "stable", state: "available" } });
  assert.deepEqual(calls, [["open", "https://docs.example/help"], ["reveal", "file-token"], ["update", "available"]]);

  const noOs = new DesktopHostBridgeRouter();
  noOs.register({ sourceId: "source-no-os", context: context({ capabilities: { nativeWindows: true, updater: true } }), handlers: {} });
  await assert.rejects(noOs.request({ ...requestBase, sourceId: "source-no-os", action: { type: "external.open", url: "https://docs.example/help" } }), /osIntegration/);

  const noUpdater = new DesktopHostBridgeRouter();
  noUpdater.register({ sourceId: "source-no-updater", context: context({ capabilities: { nativeWindows: true, osIntegration: true } }), handlers: {} });
  await assert.rejects(noUpdater.request({ ...requestBase, sourceId: "source-no-updater", action: { type: "update.status", channel: "stable", state: "available" } }), /updater/);
});
