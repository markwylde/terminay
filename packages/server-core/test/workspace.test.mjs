import test from "node:test";
import assert from "node:assert/strict";
import { assertJsonValue } from "@terminay/protocol";
import { WorkspaceStore, canonicalizeWorkspaceState, createInitialWorkspace, migrateWorkspaceState, validateWorkspace } from "../dist/index.js";

test("workspace store creates, moves, and atomically commits canonical objects", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const view = store.state.viewOrder[0];
  const created = store.apply({ commandId: "create-project", expectedRevision: 0, command: { type: "project.create", projectId: "project-a", viewId: view, root: "/tmp/a", name: "A" } });
  assert.equal(created.ok, true);
  const second = store.apply({ commandId: "create-view", expectedRevision: 1, command: { type: "view.create", viewId: "view-b", name: "B" } });
  assert.equal(second.ok, true);
  const moved = store.apply({ commandId: "move-project", expectedRevision: 2, command: { type: "project.move", projectId: "project-a", targetViewId: "view-b" } });
  assert.equal(moved.ok, true);
  assert.equal(store.state.projects["project-a"].viewId, "view-b");
  assert.equal(store.state.views[view].projectIds.includes("project-a"), false);
  assert.equal(store.state.views["view-b"].projectIds.includes("project-a"), true);
  assert.equal(Object.hasOwn(store.state.views[view], "activeProjectId"), false);
  assertJsonValue(store.state);
  assert.deepEqual(store.delta(0).events.map((event) => event.revision), [1, 2, 3]);
  const bounded = new WorkspaceStore(createInitialWorkspace("server-b"), { maxHistory: 1 });
  bounded.apply({ commandId: "v", command: { type: "view.create", viewId: "view-c", name: "C" } });
  bounded.apply({ commandId: "w", command: { type: "view.create", viewId: "view-d", name: "D" } });
  assert.deepEqual(bounded.delta(0).events, []);
  assert.equal(bounded.delta(0).state.revision, 2);
  validateWorkspace(store.state);
});

test("workspace store rejects stale and cross-scope mutations, and replays duplicate ids", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const view = store.state.viewOrder[0];
  const first = { commandId: "same", expectedRevision: 0, command: { type: "project.create", projectId: "project-a", viewId: view, root: "/tmp/a", name: "A" } };
  const committed = store.apply(first);
  assert.equal(store.apply(first).ok, true);
  assert.deepEqual(store.apply(first), committed);
  const stale = store.apply({ commandId: "stale", expectedRevision: 0, command: { type: "view.rename", viewId: view, name: "stale" } });
  assert.equal(stale.ok, false);
  const invalid = store.apply({ commandId: "bad-panel", expectedRevision: 1, command: { type: "panel.reorder", projectId: "project-a", panelIds: ["other-project-panel"] } });
  assert.equal(invalid.ok, false);
});

test("restart recovery marks running sessions interrupted without changing identity", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const snapshot = store.state;
  const projectId = "project-a"; const viewId = snapshot.viewOrder[0];
  const project = store.apply({ commandId: "project", command: { type: "project.create", projectId, viewId, root: "/tmp/a", name: "A" } });
  assert.equal(project.ok, true);
  const state = store.state;
  state.terminalSessions["session-a"] = { id: "session-a", serverId: "server-a", projectId, status: "running", createdAt: 1, outputPosition: 4 };
  // The immutable snapshot API prevents callers from mutating the store; use a
  // fresh valid state to model a persisted repository load for this unit.
  const loaded = new WorkspaceStore({ ...state, terminalSessions: { "session-a": { id: "session-a", serverId: "server-a", projectId, status: "running", createdAt: 1, outputPosition: 4 } } });
  const interrupted = loaded.markInterruptedSessions(10);
  assert.equal(interrupted.terminalSessions["session-a"].status, "interrupted");
  assert.equal(interrupted.terminalSessions["session-a"].id, "session-a");
  assert.equal(interrupted.revision, 2);
});

test("terminal session identity survives panel creation and project moves", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  assert.equal(store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } }).ok, true);
  const launch = { profileId: "profile-zsh", profileRevision: 4, profileName: "Zsh", targetSummary: "zsh", workspaceRevision: 1, settingsRevision: 4, icon: "terminal", color: "#112233" };
  assert.equal(store.apply({ commandId: "session", command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1, launch } }).ok, true);
  const panel = { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "session-a", createdAt: 1 };
  assert.equal(store.apply({ commandId: "panel", command: { type: "panel.create", panel } }).ok, true);
  assert.equal(store.apply({ commandId: "view", command: { type: "view.create", viewId: "view-b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "move", command: { type: "project.move", projectId: "project-a", targetViewId: "view-b" } }).ok, true);
  assert.equal(store.state.panels["panel-a"].projectId, "project-a");
  assert.equal(store.state.panels["panel-a"].sessionId, "session-a");
  assert.equal(store.state.terminalSessions["session-a"].id, "session-a");
  assert.deepEqual(store.state.terminalSessions["session-a"].launch, launch);
});

test("project close cascades panels and terminal session records", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  assert.equal(store.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } }).ok, true);
  assert.equal(store.apply({ commandId: "project-b", command: { type: "project.create", projectId: "project-b", viewId, root: "/tmp/b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "terminal", command: { type: "terminal.createPanel", sessionId: "session-a", projectId: "project-a", panelId: "panel-terminal", title: "Terminal 1", cwd: "/tmp/a", createdAt: 1 } }).ok, true);
  assert.equal(store.apply({ commandId: "file-panel", command: { type: "panel.create", panel: { id: "panel-file", projectId: "project-a", type: "file", path: "README.md", createdAt: 2 } } }).ok, true);

  const closed = store.apply({ commandId: "close-project-a", command: { type: "project.close", projectId: "project-a" } });

  assert.equal(closed.ok, true);
  assert.equal(store.state.projects["project-a"], undefined);
  assert.equal(store.state.panels["panel-terminal"], undefined);
  assert.equal(store.state.panels["panel-file"], undefined);
  assert.equal(store.state.terminalSessions["session-a"], undefined);
  assert.deepEqual(store.state.views[viewId].projectIds, ["project-b"]);
  assert.equal(store.state.views[viewId].activeProjectId, "project-b");
  validateWorkspace(store.state);
});

test("terminal panel close removes the terminal session record", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  assert.equal(store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } }).ok, true);
  assert.equal(store.apply({ commandId: "terminal-1", command: { type: "terminal.createPanel", sessionId: "session-1", projectId: "project-a", panelId: "panel-1", title: "Terminal 1", cwd: "/tmp/a", createdAt: 1 } }).ok, true);
  assert.equal(store.apply({ commandId: "terminal-2", command: { type: "terminal.createPanel", sessionId: "session-2", projectId: "project-a", panelId: "panel-2", title: "Terminal 2", cwd: "/tmp/a", createdAt: 2 } }).ok, true);
  assert.equal(store.apply({ commandId: "terminal-3", command: { type: "terminal.createPanel", sessionId: "session-3", projectId: "project-a", panelId: "panel-3", title: "Terminal 3", cwd: "/tmp/a", createdAt: 3 } }).ok, true);

  const closed = store.apply({ commandId: "close-panel-2", command: { type: "panel.close", panelId: "panel-2" } });

  assert.equal(closed.ok, true);
  assert.equal(store.state.panels["panel-2"], undefined);
  assert.equal(store.state.terminalSessions["session-2"], undefined);
  assert.deepEqual(store.state.projects["project-a"].panelIds, ["panel-1", "panel-3"]);
  assert.deepEqual(Object.keys(store.state.terminalSessions).sort(), ["session-1", "session-3"]);
  validateWorkspace(store.state);
});

test("empty project and view selections remain valid JSON after final removals", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  assert.equal(store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } }).ok, true);
  assert.equal(store.apply({ commandId: "terminal", command: { type: "terminal.createPanel", sessionId: "session-a", projectId: "project-a", panelId: "panel-a", title: "Terminal 1", cwd: "/tmp/a", createdAt: 1 } }).ok, true);

  assert.equal(store.apply({ commandId: "close-panel", command: { type: "panel.close", panelId: "panel-a" } }).ok, true);
  assert.deepEqual(store.state.projects["project-a"].panelIds, []);
  assert.equal(Object.hasOwn(store.state.projects["project-a"], "activePanelId"), false);
  assertJsonValue(store.state);

  assert.equal(store.apply({ commandId: "close-project", command: { type: "project.close", projectId: "project-a" } }).ok, true);
  assert.deepEqual(store.state.views[viewId].projectIds, []);
  assert.equal(Object.hasOwn(store.state.views[viewId], "activeProjectId"), false);
  assertJsonValue(store.state);
});

test("moving the final panel omits the empty source project's active selection", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  for (const projectId of ["project-a", "project-b"]) {
    assert.equal(store.apply({ commandId: projectId, command: { type: "project.create", projectId, viewId, root: `/tmp/${projectId}`, name: projectId } }).ok, true);
  }
  assert.equal(store.apply({ commandId: "terminal", command: { type: "terminal.createPanel", sessionId: "session-a", projectId: "project-a", panelId: "panel-a", title: "Terminal 1", cwd: "/tmp/project-a", createdAt: 1 } }).ok, true);

  assert.equal(store.apply({ commandId: "move-panel", command: { type: "panel.move", panelId: "panel-a", targetProjectId: "project-b" } }).ok, true);
  assert.deepEqual(store.state.projects["project-a"].panelIds, []);
  assert.equal(Object.hasOwn(store.state.projects["project-a"], "activePanelId"), false);
  assertJsonValue(store.state);
});

test("two client command streams get one ordered commit and one explicit stale conflict", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const defaultView = store.state.viewOrder[0];
  const clientOne = store.apply({ commandId: "client-one", expectedRevision: 0, command: { type: "view.create", viewId: "view-b", name: "B" } });
  assert.equal(clientOne.ok, true);
  const clientTwo = store.apply({ commandId: "client-two", expectedRevision: 1, command: { type: "project.create", projectId: "project-a", viewId: defaultView, root: "/tmp/a", name: "A" } });
  assert.equal(clientTwo.ok, true);
  const stale = store.apply({ commandId: "client-one-stale", expectedRevision: 1, command: { type: "view.rename", viewId: defaultView, name: "Old revision" } });
  assert.equal(stale.ok, false);
  assert.equal(store.state.revision, 2);
});

test("v0 workspace snapshots migrate idempotently without terminal content", () => {
  const migrated = migrateWorkspaceState({ schemaVersion: 0, serverId: "server-a", projects: { "project-a": { root: "/tmp/a", name: "A", output: "must-not-copy" } } }, "fallback");
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.projects["project-a"].root, "/tmp/a");
  assert.equal(Object.keys(migrated.terminalSessions).length, 0);
  assert.deepEqual(migrateWorkspaceState(migrated, "fallback"), migrated);
  validateWorkspace(migrated);
});

test("canonical persistence strips transient renderer fields and terminal content", () => {
  const initial = createInitialWorkspace("server-a");
  const viewId = initial.viewOrder[0];
  const state = {
    ...initial,
    views: { ...initial.views, [viewId]: { ...initial.views[viewId], modal: "rename", hover: "panel-a", search: "secret query" } },
    projects: {},
    panels: {},
    terminalSessions: {},
    dragGeometry: { x: 1, y: 2 },
    terminalOutput: "must-not-persist",
  };
  const canonical = canonicalizeWorkspaceState(state);
  assert.equal("dragGeometry" in canonical, false);
  assert.equal("terminalOutput" in canonical, false);
  assert.equal("modal" in canonical.views[viewId], false);
  assert.equal("hover" in canonical.views[viewId], false);
  assert.equal("search" in canonical.views[viewId], false);
  validateWorkspace(canonical);
});
