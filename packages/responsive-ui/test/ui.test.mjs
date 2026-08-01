import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionProfileStore, createHostCapabilityProvider } from "@terminay/client-core";
import {
  classifyResponsiveLayout,
  createAccessibleDrawerModel,
  createAccessibleSelectorModel,
  createConnectionMenuFocusState,
  createConnectionManagementModel,
  createConnectionMenuModel,
  createConnectionRenameForm,
  createResponsiveViewportModel,
  createResponsiveWorkspaceNavigation,
  createResponsiveUiProvider,
  createResponsiveWorkspaceShellModel,
  createResponsiveRouteTabListModel,
  createSharedFileSelectionModel,
  runSharedFileSelection,
  createSharedWorkspaceRouteEntries,
  createSharedWorkspaceRouteRenderModel,
  createSharedWorkspaceRouteRenderModels,
  createTerminalAccessoryModel,
  parseHostBridgeMessage,
  reduceAccessibleSelectorKey,
  reduceConnectionMenuKey,
  reduceTerminalAccessoryAction,
  reduceResponsiveRouteTabKey,
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

test("shared workspace shell composes the same client model for web and Desktop hosts", () => {
  const client = { snapshot: { state: "connected", revision: 4, cursor: "cursor-4", stale: false, reconnectAttempt: 0 } };
  const profiles = new ConnectionProfileStore({ now: () => 100 });
  profiles.remember({ id: "staging", serverId: "srv-staging", label: "Staging", origin: "https://staging.example.test", status: "offline" });
  const web = createResponsiveWorkspaceShellModel(createResponsiveUiProvider({ client }), {
    connectionProfiles: profiles,
    navigation: { route: "settings", projectId: "project-a" },
    viewportWidth: 640,
  });
  const desktop = createResponsiveWorkspaceShellModel(createResponsiveUiProvider({
    client,
    capabilities: createHostCapabilityProvider({ nativeWindows: true, serverExposure: true }),
  }), {
    connectionProfiles: profiles,
    navigation: { route: "settings", projectId: "project-a" },
    viewportWidth: 640,
  });

  assert.equal(web.role, "application");
  assert.equal(web.layout, "narrow");
  assert.equal(web.route.presentation, "in-page");
  assert.equal(desktop.route.presentation, "native-auxiliary");
  assert.equal(web.routeComponent.component.id, "shared.route.settings");
  assert.equal(desktop.routeComponent.component.id, "shared.route.settings");
  assert.deepEqual(web.routeComponent.component, desktop.routeComponent.component);
  assert.deepEqual(web.navigation, desktop.navigation);
  assert.deepEqual(web.routes.map((entry) => entry.route), desktop.routes.map((entry) => entry.route));
  assert.equal(desktop.connectionMenu.items[0].actions.includes("expose"), true);
  assert.deepEqual(web.connectionProfiles, desktop.connectionProfiles);
  assert.equal(Object.isFrozen(web), true);
  assert.equal("terminalOutput" in web, false);
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
  const withoutExposure = createConnectionMenuModel(store);
  assert.equal(withoutExposure.items[0].actions.includes("expose"), false);
});

test("connection management exposes responsive cards, rename validation, and distinct confirmations", () => {
  const store = new ConnectionProfileStore({ now: () => 100 });
  const remote = store.remember({ id: "managed", serverId: "srv-managed", label: "Production", origin: "https://managed.example.test", status: "connected" });
  const wide = createConnectionManagementModel(store, { capabilities: createHostCapabilityProvider({ serverExposure: true }), canRevoke: true, viewportWidth: 1200 });
  const narrow = createConnectionManagementModel(store, { canRevoke: true, viewportWidth: 400 });
  const remoteCard = wide.cards.find((card) => card.profileId === remote.id);
  assert.deepEqual(remoteCard?.actions, ["open", "focus", "switch", "manage", "disconnect", "forget", "revoke", "rename", "archive"]);
  assert.equal(wide.cards[0].isLocal, true);
  assert.equal(wide.cards[0].actions.includes("rename"), false);
  assert.equal(wide.cards[0].actions.includes("expose"), true);
  assert.equal(narrow.layout, "narrow");
  assert.equal(narrow.cards.every((card) => card.layout === "narrow"), true);
  const form = createConnectionRenameForm(store, remote.id, "  Staging  ");
  assert.deepEqual({ value: form.value, canSubmit: form.canSubmit, initialLabel: form.initialLabel, submitLabel: form.submitLabel }, { value: "  Staging  ", canSubmit: true, initialLabel: "Production", submitLabel: "Save name" });
  assert.equal(createConnectionRenameForm(store, remote.id, "bad\nname").error, "Connection names cannot contain control characters");
  assert.equal(createConnectionRenameForm(store, "local", "Local copy").error, "Local cannot be renamed");
  const confirmations = new Map(remoteCard.confirmations.map((confirmation) => [confirmation.action, confirmation]));
  assert.match(confirmations.get("forget").body, /does not revoke/);
  assert.match(confirmations.get("revoke").body, /server authorization/);
  assert.match(confirmations.get("archive").body, /saved origin/);
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

test("responsive terminal accessory exposes bounded safe keys with large touch targets", () => {
  const accessory = createTerminalAccessoryModel({ includePaging: false });
  assert.equal(accessory.role, "toolbar");
  assert.equal(accessory.preservesDesktopKeyboardInput, true);
  assert.equal(accessory.touchTarget.minWidth, 44);
  assert.equal(accessory.controls.every((control) => control.touchTarget.minHeight >= 44), true);
  assert.equal(accessory.controls.some((control) => control.id === "page-up"), false);
  assert.deepEqual(accessory.controls.find((control) => control.id === "escape")?.input, "\u001b");
  const modifier = reduceTerminalAccessoryAction({ ctrl: false, alt: false }, { type: "toggle-modifier", modifier: "ctrl" });
  assert.deepEqual(modifier, { state: { ctrl: true, alt: false }, appliedModifiers: [] });
  const pressed = reduceTerminalAccessoryAction(modifier.state, { type: "press", control: "arrow-up" });
  assert.deepEqual(pressed, { state: { ctrl: false, alt: false }, appliedModifiers: ["ctrl"], input: "\u001b[A" });
});

test("visual viewport model shrinks the focused terminal and restores desktop geometry", () => {
  const keyboard = createResponsiveViewportModel({
    layoutWidth: 390,
    layoutHeight: 714,
    visualWidth: 390,
    visualHeight: 404,
    chromeHeight: 48,
    accessoryHeight: 48,
  });
  assert.equal(keyboard.layout, "narrow");
  assert.equal(keyboard.keyboardVisible, true);
  assert.equal(keyboard.keyboardInset, 310);
  assert.equal(keyboard.shellHeight, 404);
  assert.equal(keyboard.terminalHeight, 308);
  assert.equal(keyboard.horizontalOverflow, false);
  assert.equal(keyboard.keepsFocusedTerminalVisible, true);
  assert.equal(keyboard.restoredShellHeight, 714);
});

test("drawers and selectors expose focus restoration, ARIA state, and disabled-option navigation", () => {
  const drawer = createAccessibleDrawerModel({ id: "projects-drawer", label: "Projects", open: true, restoreFocusId: "project-trigger" });
  assert.deepEqual({ role: drawer.role, ariaModal: drawer.ariaModal, closeOnEscape: drawer.closeOnEscape, restore: drawer.focus.restoreFocusId }, {
    role: "dialog",
    ariaModal: true,
    closeOnEscape: true,
    restore: "project-trigger",
  });
  assert.equal(drawer.touchTarget.minWidth, 44);
  const selector = createAccessibleSelectorModel({
    id: "view-selector",
    label: "Workspace view",
    selectedId: "overview",
    expanded: true,
    options: [
      { id: "overview", label: "Overview" },
      { id: "terminal", label: "Terminal", disabled: true },
      { id: "files", label: "Files" },
    ],
  });
  assert.equal(selector.ariaHasPopup, "listbox");
  assert.equal(selector.ariaActiveDescendant, "view-selector-option-overview");
  assert.deepEqual(selector.options.map((option) => [option.ariaPosInSet, option.ariaSetSize, option.disabled]), [[1, 3, false], [2, 3, true], [3, 3, false]]);
  const moved = reduceAccessibleSelectorKey({ expanded: true, activeIndex: 0 }, "ArrowDown", selector.options);
  assert.deepEqual(moved, { state: { expanded: true, activeIndex: 2 }, intent: "move" });
  const selected = reduceAccessibleSelectorKey(moved.state, "Enter", selector.options);
  assert.deepEqual(selected, { state: { expanded: false, activeIndex: 2 }, intent: "select" });
});

test("shared route entries keep web in-page and let Desktop opt into native auxiliaries", () => {
  const web = createSharedWorkspaceRouteEntries();
  const desktop = createSharedWorkspaceRouteEntries(createHostCapabilityProvider({ nativeWindows: true }));
  assert.equal(web.find((entry) => entry.route === "settings").presentation, "in-page");
  assert.equal(desktop.find((entry) => entry.route === "settings").presentation, "native-auxiliary");
  assert.deepEqual(web.map((entry) => entry.route), ["workspace", "connections", "settings", "recordings", "macros", "file", "git"]);
});

test("shared route components expose complete immutable regions while hosts choose presentation", () => {
  const web = createSharedWorkspaceRouteRenderModel("settings");
  const desktop = createSharedWorkspaceRouteRenderModel("settings", createHostCapabilityProvider({ nativeWindows: true }));
  const all = createSharedWorkspaceRouteRenderModels();

  assert.equal(web.presentation, "in-page");
  assert.equal(desktop.presentation, "native-auxiliary");
  assert.deepEqual(web.component, desktop.component);
  assert.deepEqual(web.component, {
    id: "shared.route.settings",
    label: "Settings",
    landmark: "main",
    regions: ["settings-sections", "settings-editor"],
  });
  assert.equal(all.length, 7);
  assert.equal(all.every((model) => model.component.regions.length > 0), true);
  assert.equal(Object.isFrozen(web), true);
  assert.equal(Object.isFrozen(web.component), true);
  assert.equal(Object.isFrozen(web.component.regions), true);
});

test("shared route tabs preserve roving focus, automatic activation, layout orientation, and 44px targets", () => {
  const routes = createSharedWorkspaceRouteEntries();
  const narrow = createResponsiveRouteTabListModel({
    routes,
    activeRoute: "workspace",
    layout: "narrow",
    disabledRoutes: ["connections"],
  });
  assert.equal(narrow.role, "tablist");
  assert.equal(narrow.ariaOrientation, "horizontal");
  assert.equal(narrow.items.find((item) => item.route === "workspace")?.tabIndex, 0);
  assert.equal(narrow.items.find((item) => item.route === "connections")?.ariaDisabled, true);
  assert.equal(narrow.items.every((item) => item.touchTarget.minHeight >= 44), true);
  assert.deepEqual(reduceResponsiveRouteTabKey(narrow, "ArrowRight"), {
    focusRoute: "settings",
    activeRoute: "settings",
    changed: true,
  });
  assert.deepEqual(reduceResponsiveRouteTabKey(narrow, "End", "settings"), {
    focusRoute: "git",
    activeRoute: "git",
    changed: true,
  });
  assert.deepEqual(reduceResponsiveRouteTabKey(narrow, "unrelated", "settings"), {
    focusRoute: "settings",
    activeRoute: "workspace",
    changed: false,
  });
  assert.equal(createResponsiveRouteTabListModel({ routes, activeRoute: "workspace", layout: "wide" }).ariaOrientation, "vertical");
  assert.throws(() => createResponsiveRouteTabListModel({ routes, activeRoute: "workspace", layout: "wide", disabledRoutes: ["workspace"] }), /active route/u);
});

test("host capabilities change presentation without changing workspace behaviour", () => {
  const client = { snapshot: { state: "connected", revision: 9, cursor: "cursor-9", stale: false, reconnectAttempt: 0 } };
  const profiles = new ConnectionProfileStore({ now: () => 200 });
  profiles.remember({ id: "remote", serverId: "srv-remote", label: "Remote", origin: "https://remote.example.test", status: "connected" });
  const options = {
    connectionProfiles: profiles,
    navigation: { route: "file", projectId: "project-a", viewId: "view-a", panelId: "panel-a" },
    viewportWidth: 1280,
  };
  const web = createResponsiveWorkspaceShellModel(createResponsiveUiProvider({ client }), options);
  const desktop = createResponsiveWorkspaceShellModel(createResponsiveUiProvider({
    client,
    capabilities: createHostCapabilityProvider({ nativeWindows: true, filePicker: true, osIntegration: true }),
  }), options);

  assert.equal(web.route.presentation, "in-page");
  assert.equal(desktop.route.presentation, "native-auxiliary");
  assert.deepEqual(web.navigation, desktop.navigation);
  assert.deepEqual(web.connection, desktop.connection);
  assert.deepEqual(web.connectionProfiles, desktop.connectionProfiles);
  assert.deepEqual(web.routeComponent.component, desktop.routeComponent.component);
  assert.deepEqual(web.routes.map((entry) => entry.route), desktop.routes.map((entry) => entry.route));
});

test("file selection uses a native dialog only with filePicker and otherwise falls back to the File route", async () => {
  let fallbackCalls = 0;
  const fallback = createSharedFileSelectionModel();
  assert.equal(fallback.presentation, "in-page");
  assert.equal(fallback.route, "file");
  assert.equal(fallback.fallback.label, "Browse workspace files");
  assert.equal(Object.isFrozen(fallback), true);
  assert.deepEqual(await runSharedFileSelection({ onFallback: () => { fallbackCalls += 1; } }), { kind: "fallback", route: "file" });
  assert.equal(fallbackCalls, 1);

  const nativeCalls = [];
  const native = createSharedFileSelectionModel(createHostCapabilityProvider({ filePicker: true }), { multiple: true });
  assert.equal(native.presentation, "native-dialog");
  assert.equal(native.multiple, true);
  const selected = await runSharedFileSelection({
    capabilities: createHostCapabilityProvider({ filePicker: true }),
    actions: { chooseFile: async (request) => { nativeCalls.push(request); return ["/workspace/README.md"]; } },
    multiple: true,
    onFallback: () => { throw new Error("native picker must not fall back"); },
  });
  assert.deepEqual(selected, { kind: "native", files: ["/workspace/README.md"] });
  assert.deepEqual(nativeCalls, [{ multiple: true }]);
  await assert.rejects(runSharedFileSelection({ capabilities: createHostCapabilityProvider({ filePicker: true }), onFallback: () => {} }), /chooseFile host action/);
});
