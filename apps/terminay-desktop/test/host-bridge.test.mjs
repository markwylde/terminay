import test from "node:test";
import assert from "node:assert/strict";
import { DESKTOP_HOST_BRIDGE_VERSION, DesktopHostBridgeRouter, createDesktopPreloadBridge, installDesktopPreloadBridge, validateDesktopHostAction } from "../dist/index.js";

const context = (sourceId = "source-a", capabilities = { clipboardWrite: 1 }) => ({ schemaVersion: 1, bootstrapVersion: 1, sourceId, windowId: "window-a", serverId: "server-a", profileId: "local:one", bundleId: "bundle_12345678", applicationProtocolVersion: "1", hostKind: "desktop", hostBridgeVersion: 1, byteEndpointVersion: 1, capabilities });
const request = (action, overrides = {}) => ({ schemaVersion: 1, bridgeVersion: 1, sourceId: "source-a", windowId: "window-a", profileId: "local:one", serverId: "server-a", userGesture: true, action, ...overrides });

test("canonical bridge validates binding, capability, and user gesture", async () => {
  const calls = []; const router = new DesktopHostBridgeRouter();
  router.register({ sourceId: "source-a", context: context(), handlers: { "clipboard.write": (action) => calls.push(action.text) } });
  await router.request(request({ type: "clipboard.write", text: "ok" }));
  assert.deepEqual(calls, ["ok"]);
  await assert.rejects(router.request(request({ type: "clipboard.write", text: "no" }, { userGesture: false })), /user gesture/);
  await assert.rejects(router.request(request({ type: "clipboard.write", text: "no" }, { serverId: "server-b" })), /outside its binding/);
  assert.throws(() => validateDesktopHostAction({ type: "clipboard.read" }), /not allowed/);
});

test("semantic actions require their canonical capability", async () => {
  const router = new DesktopHostBridgeRouter(); router.register({ sourceId: "source-a", context: context("source-a", {}), handlers: {} });
  await assert.rejects(router.request(request({ type: "menu.invoke", command: "new-terminal" })), /nativeMenus/);
  assert.deepEqual(validateDesktopHostAction({ type: "os.open-external", url: "http://example.com/help" }), { type: "os.open-external", url: "http://example.com/help" });
  assert.deepEqual(validateDesktopHostAction({ type: "os.open-external", url: "https://example.com/help" }), { type: "os.open-external", url: "https://example.com/help" });
  assert.throws(() => validateDesktopHostAction({ type: "os.open-external", url: "javascript:alert(1)" }), /invalid/);
});

test("preload projects only canonical context and validated requests", async () => {
  const invocations = []; const hostContext = context();
  const bridge = createDesktopPreloadBridge({ invoke: async (channel, payload) => { invocations.push({ channel, payload }); return channel.endsWith("get-context") ? hostContext : undefined; } });
  assert.equal((await bridge.getContext()).bundleId, hostContext.bundleId);
  await bridge.requestAction({ type: "clipboard.write", text: "safe" }, { context: hostContext, userGesture: true });
  assert.equal(invocations[1].payload.action.type, "clipboard.write");
  const exposed = []; installDesktopPreloadBridge({ exposeInMainWorld(name, value) { exposed.push({ name, value }); } }, bridge);
  assert.deepEqual(Object.keys(exposed[0].value).sort(), ["getContext", "requestAction", "version"]);
  assert.equal(exposed[0].value.version, DESKTOP_HOST_BRIDGE_VERSION);
});
