import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(store.apply({ commandId: "session", command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 } }).ok, true);
  const panel = { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "session-a", createdAt: 1 };
  assert.equal(store.apply({ commandId: "panel", command: { type: "panel.create", panel } }).ok, true);
  assert.equal(store.apply({ commandId: "view", command: { type: "view.create", viewId: "view-b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "move", command: { type: "project.move", projectId: "project-a", targetViewId: "view-b" } }).ok, true);
  assert.equal(store.state.panels["panel-a"].projectId, "project-a");
  assert.equal(store.state.panels["panel-a"].sessionId, "session-a");
  assert.equal(store.state.terminalSessions["session-a"].id, "session-a");
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
  assert.equal(migrated.schemaVersion, 1);
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
