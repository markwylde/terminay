import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopShellHeaderModel } from "../dist/main/index.js";

const state = (overrides = {}) => ({
  phase: "ready",
  currentProfileId: "local:one",
  localServerState: "ready",
  ...overrides,
});

const profile = (overrides = {}) => ({
  id: "remote:zeta",
  serverId: "server-zeta",
  origin: "https://zeta.example",
  label: "Zeta",
  kind: "remote",
  immutable: false,
  archived: false,
  status: "connected",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("shell header projects menu, native status, and opaque window/view ownership", () => {
  const model = createDesktopShellHeaderModel({
    currentConnection: { profileId: "local:one", serverId: "server-one", label: "Local", kind: "local", status: "connected", local: true },
    state: state(),
    profiles: [profile(), profile({ id: "local:one", serverId: "server-one", origin: "http://127.0.0.1:4311", label: "Local", kind: "local", immutable: true })],
    windows: [
      { windowId: "window-z", connectionId: "remote:zeta", workspaceViewId: "view-z", geometry: { x: 0, y: 0, width: 1000, height: 700 } },
      { windowId: "window-a", connectionId: "local:one", workspaceViewId: "view-a" },
    ],
    canManageConnections: true,
    canExposeServer: true,
  });

  assert.equal(model.version, 1);
  assert.equal(model.currentConnection?.label, "Local");
  assert.deepEqual(model.connections.map((entry) => ({ id: entry.profileId, selected: entry.selected })), [
    { id: "local:one", selected: true },
    { id: "remote:zeta", selected: false },
  ]);
  assert.equal(model.connections[0].actions.forget, false);
  assert.equal(model.connections[1].actions.disconnect, true);
  assert.deepEqual(model.windows, [
    { windowId: "window-a", connectionId: "local:one", workspaceViewId: "view-a" },
    { windowId: "window-z", connectionId: "remote:zeta", workspaceViewId: "view-z" },
  ]);
  assert.deepEqual(model.menu, { addConnection: true, manageConnections: true, exposeCurrentServer: true });
  assert.deepEqual(model.nativeStatus, { phase: "ready", localServer: "ready", status: "ready", hasError: false });
  assert.equal(JSON.stringify(model).includes("geometry"), false);
  assert.equal(JSON.stringify(model).includes("terminal"), false);
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.connections), true);
});

test("failed Local state remains explicit and does not expose unsafe host errors", () => {
  const model = createDesktopShellHeaderModel({
    currentConnection: { profileId: "local:one", serverId: "server-one", label: "Local", kind: "local", status: "failed", local: true },
    state: state({ phase: "failed", localServerState: "crashed", error: new Error("private path /tmp/secret") }),
    profiles: [profile({ id: "local:one", serverId: "server-one", origin: "http://127.0.0.1:4311", label: "Local", kind: "local", immutable: true, status: "failed" })],
    windows: [],
    canManageConnections: true,
    canExposeServer: true,
  });

  assert.equal(model.nativeStatus.status, "failed");
  assert.equal(model.nativeStatus.hasError, true);
  assert.deepEqual(model.menu, { addConnection: true, manageConnections: true, exposeCurrentServer: false });
  assert.equal(JSON.stringify(model).includes("private path"), false);
  assert.equal(model.connections[0].actions.retry, true);
});

test("remote exposure stays capability-gated and archived profiles do not enter the menu", () => {
  const model = createDesktopShellHeaderModel({
    currentConnection: { profileId: "remote:zeta", serverId: "server-zeta", label: "Zeta", kind: "remote", status: "connected", local: false },
    state: state({ currentProfileId: "remote:zeta" }),
    profiles: [profile(), profile({ id: "remote:old", label: "Old", archived: true, status: "archived" })],
    windows: [],
    canManageConnections: false,
    canExposeServer: true,
  });

  assert.deepEqual(model.connections.map((entry) => entry.profileId), ["remote:zeta"]);
  assert.deepEqual(model.menu, { addConnection: false, manageConnections: false, exposeCurrentServer: false });
});
