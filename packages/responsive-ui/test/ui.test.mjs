import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionProfileStore, createHostCapabilityProvider } from "@terminay/client-core";
import {
  classifyResponsiveLayout,
  createConnectionMenuFocusState,
  createConnectionMenuModel,
  createResponsiveWorkspaceNavigation,
  createSharedWorkspaceRouteEntries,
  parseHostBridgeMessage,
  reduceConnectionMenuKey,
} from "../dist/index.js";

test("responsive layout breakpoints are deterministic", () => {
  assert.equal(classifyResponsiveLayout(400), "narrow");
  assert.equal(classifyResponsiveLayout(800), "medium");
  assert.equal(classifyResponsiveLayout(1200), "wide");
});

test("shared navigation is route-based and host bridge rejects privileged payloads", () => {
  assert.deepEqual(createResponsiveWorkspaceNavigation({ route: "settings", projectId: "project-a" }), { route: "settings", projectId: "project-a" });
  assert.deepEqual(parseHostBridgeMessage({ type: "workspace.ready", payload: { serverLabel: "Local" } }), { type: "workspace.ready", payload: { serverLabel: "Local" } });
  assert.equal(parseHostBridgeMessage({ type: "host.profile", payload: { reconnectGrant: "secret" } }), undefined);
  assert.equal(parseHostBridgeMessage({ type: "host.profile", payload: { terminalOutput: "secret" } }), undefined);
});

test("shared connection menu is deterministic, accessible, and capability-gated", () => {
  const store = new ConnectionProfileStore({ now: () => 100 });
  store.remember({ id: "zulu", serverId: "srv-zulu", label: "Zulu", origin: "https://zulu.example.test", status: "offline" });
  store.remember({ id: "alpha", serverId: "srv-alpha", label: "Alpha", origin: "https://alpha.example.test", status: "connected" });
  const model = createConnectionMenuModel(store, { capabilities: createHostCapabilityProvider({ serverExposure: true }), canRevoke: true });
  assert.equal(model.role, "menu");
  assert.deepEqual(model.items.map((item) => item.label), ["Local", "Alpha", "Zulu"]);
  assert.deepEqual(model.items.map((item) => [item.position, item.setSize]), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(model.items[0].isCurrent, true);
  assert.equal(model.items[0].ariaChecked, true);
  assert.deepEqual(model.items.map((item) => [item.ariaPosInSet, item.ariaSetSize]), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(model.items[0].actions.includes("expose"), true);
  assert.equal(model.items[1].actions.includes("expose"), false);
  assert.equal(model.items[2].ariaLabel, "Zulu — offline");
});

test("connection menu keyboard state wraps, activates, and safely handles empty touch menus", () => {
  const initial = createConnectionMenuFocusState(3);
  const expanded = reduceConnectionMenuKey(initial, "ArrowDown", 3);
  assert.deepEqual(expanded, { state: { expanded: true, activeIndex: 1 }, intent: "move" });
  const wrapped = reduceConnectionMenuKey(expanded.state, "ArrowUp", 3);
  assert.deepEqual(wrapped.state, { expanded: true, activeIndex: 0 });
  const activated = reduceConnectionMenuKey(wrapped.state, "Enter", 3);
  assert.deepEqual(activated, { state: { expanded: false, activeIndex: 0 }, intent: "activate" });
  const empty = reduceConnectionMenuKey(createConnectionMenuFocusState(0), "ArrowDown", 0);
  assert.deepEqual(empty, { state: { expanded: false, activeIndex: -1 }, intent: "none" });
});

test("shared route entries keep web in-page and let Desktop opt into native auxiliaries", () => {
  const web = createSharedWorkspaceRouteEntries();
  const desktop = createSharedWorkspaceRouteEntries(createHostCapabilityProvider({ nativeWindows: true }));
  assert.equal(web.find((entry) => entry.route === "settings").presentation, "in-page");
  assert.equal(desktop.find((entry) => entry.route === "settings").presentation, "native-auxiliary");
  assert.deepEqual(web.map((entry) => entry.route), ["workspace", "connections", "settings", "recordings", "macros", "file", "git"]);
});
