import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore, createInitialWorkspace } from "../dist/index.js";

/** Two projects, `project-a` with two terminals and `project-b` with one. */
function workspace(options = {}) {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"), options);
  const view = store.state.viewOrder[0];
  for (const id of ["project-a", "project-b"])
    assert.equal(store.apply({ commandId: `create-${id}`, command: { type: "project.create", projectId: id, viewId: view, root: `/tmp/${id}`, name: id } }).ok, true);
  for (const [id, projectId] of [["a1", "project-a"], ["a2", "project-a"], ["b1", "project-b"]]) {
    const applied = store.apply({ commandId: `open-${id}`, command: { type: "terminal.createPanel", sessionId: `session-${id}`, projectId, panelId: `panel-${id}`, cwd: "/tmp", createdAt: 1 } });
    assert.equal(applied.ok, true, applied.conflict?.message);
  }
  return store;
}

let serial = 0;
/** Apply a command and return the change record its commit produced. */
function commit(store, command) {
  serial += 1;
  const applied = store.apply({ commandId: `command-${serial}`, command });
  assert.equal(applied.ok, true, applied.conflict?.message);
  return store.recordAt(applied.revision);
}

const ids = (collection) => Object.keys(collection ?? {}).sort();

test("a rename's record carries that panel and nothing else", () => {
  const store = workspace();
  const before = store.state;
  const record = commit(store, { type: "panel.update", panelId: "panel-a1", patch: { title: "api" } });
  assert.equal(record.fromRevision, before.revision);
  assert.equal(record.revision, before.revision + 1);
  assert.equal(record.cursor, String(record.revision));
  assert.equal(record.type, "panel.update");
  assert.deepEqual(Object.keys(record.changed), ["panels"]);
  assert.deepEqual(ids(record.changed.panels), ["panel-a1"]);
  assert.equal(record.changed.panels["panel-a1"], store.state.panels["panel-a1"]);
  assert.deepEqual(record.removed, {});
  assert.equal(record.viewOrder, undefined);
});

test("an object a commit left alone is the same object before and after", () => {
  const store = workspace();
  const before = store.state;
  commit(store, { type: "panel.update", panelId: "panel-a1", patch: { title: "api" } });
  const after = store.state;
  assert.notEqual(after, before);
  assert.notEqual(after.panels["panel-a1"], before.panels["panel-a1"]);
  assert.equal(after.panels["panel-a2"], before.panels["panel-a2"]);
  assert.equal(after.panels["panel-b1"], before.panels["panel-b1"]);
  // A collection none of whose members changed is itself unchanged.
  for (const collection of ["views", "projects", "folders", "terminalSessions"])
    assert.equal(after[collection], before[collection], collection);
  assert.equal(after.viewOrder, before.viewOrder);
});

test("a move between projects names the panel, both projects, their folders, and the session", () => {
  const store = workspace();
  const before = store.state;
  const record = commit(store, { type: "panel.move", panelId: "panel-a1", targetProjectId: "project-b" });
  assert.deepEqual(ids(record.changed.panels), ["panel-a1"]);
  assert.deepEqual(ids(record.changed.projects), ["project-a", "project-b"]);
  assert.deepEqual(ids(record.changed.terminalSessions), ["session-a1"]);
  const folders = ids(record.changed.folders);
  assert.equal(folders.includes(before.panels["panel-a1"].folderId), true);
  assert.equal(folders.includes(store.state.panels["panel-a1"].folderId), true);
  assert.equal(store.state.panels["panel-a2"], before.panels["panel-a2"]);
  assert.equal(store.state.terminalSessions["session-b1"], before.terminalSessions["session-b1"]);
});

test("a move between folders names the panel, both folders, and their project", () => {
  const store = workspace();
  const created = commit(store, { type: "folder.create", projectId: "project-a", name: "Scratch" });
  const [folderId] = ids(created.changed.folders);
  assert.deepEqual(ids(created.changed.projects), ["project-a"]);
  const before = store.state;
  const record = commit(store, { type: "panel.moveToFolder", panelId: "panel-a1", folderId });
  assert.deepEqual(ids(record.changed.panels), ["panel-a1"]);
  assert.deepEqual(ids(record.changed.folders), [before.panels["panel-a1"].folderId, folderId].sort());
  assert.deepEqual(ids(record.changed.projects), ["project-a"]);
  assert.equal(record.changed.terminalSessions, undefined);
  assert.equal(store.state.projects["project-b"], before.projects["project-b"]);
  assert.equal(store.state.terminalSessions, before.terminalSessions);
});

test("a close names the panel as removed", () => {
  const store = workspace();
  const record = commit(store, { type: "panel.close", panelId: "panel-a2" });
  assert.deepEqual(record.removed.panels, ["panel-a2"]);
  assert.equal(record.changed.panels, undefined);
  assert.deepEqual(ids(record.changed.projects), ["project-a"]);
});

test("a created project's record carries the project, its folder, and its view", () => {
  const store = workspace();
  const view = store.state.viewOrder[0];
  const record = commit(store, { type: "project.create", projectId: "project-c", viewId: view, root: "/tmp/c", name: "C" });
  assert.deepEqual(ids(record.changed.projects), ["project-c"]);
  assert.equal(ids(record.changed.folders).length, 1);
  assert.deepEqual(ids(record.changed.views), [view]);
});

test("a command that changes nothing still commits, and its record is empty", () => {
  const store = workspace();
  const before = store.state;
  const record = commit(store, { type: "panel.update", panelId: "panel-a1", patch: {} });
  assert.equal(record.revision, before.revision + 1);
  assert.deepEqual(record.changed, {});
  assert.deepEqual(record.removed, {});
  assert.equal(store.state.panels["panel-a1"], before.panels["panel-a1"]);
  assert.equal(store.state.panels, before.panels);
});

test("the committed state cannot be changed by a reader", () => {
  const store = workspace();
  const state = store.state;
  assert.throws(() => { state.revision = 99; }, TypeError);
  assert.throws(() => { state.panels["panel-x"] = {}; }, TypeError);
  assert.throws(() => { state.panels["panel-a1"].title = "hijacked"; }, TypeError);
  assert.throws(() => { state.projects["project-a"].panelIds.push("panel-x"); }, TypeError);
  assert.throws(() => { state.viewOrder.push("view-x"); }, TypeError);
  assert.notEqual(store.state.panels["panel-a1"].title, "hijacked");
  assert.equal(store.state.revision, state.revision);
});

test("the state a commit hook is given is the committed one, and a failing hook publishes nothing", () => {
  let fail = false;
  const written = [];
  const store = workspace({ commit: (state) => { if (fail) throw new Error("disk full"); written.push(state); } });
  const before = store.state;
  let heard = 0;
  store.subscribe(() => { heard += 1; });
  fail = true;
  assert.throws(() => store.apply({ commandId: "doomed", command: { type: "panel.update", panelId: "panel-a1", patch: { title: "x" } } }), /disk full/);
  assert.equal(store.state, before);
  assert.equal(heard, 0);
  assert.equal(store.recordAt(before.revision + 1), undefined);
  fail = false;
  const applied = store.apply({ commandId: "fine", command: { type: "panel.update", panelId: "panel-a1", patch: { title: "x" } } });
  assert.equal(applied.ok, true);
  assert.equal(written.at(-1), store.state);
  assert.equal(heard, 1);
});

test("observers are handed the change record", () => {
  const store = workspace();
  const heard = [];
  store.subscribe((event, record) => heard.push({ event, record }));
  const record = commit(store, { type: "panel.update", panelId: "panel-b1", patch: { title: "db" } });
  assert.equal(heard.length, 1);
  assert.equal(heard[0].record, record);
  assert.equal(heard[0].event.revision, record.revision);
});

test("a delta is the records since a revision, and a snapshot once they are gone", () => {
  const store = workspace({ maxHistory: 3 });
  const start = store.state.revision;
  for (const title of ["one", "two", "three"]) commit(store, { type: "panel.update", panelId: "panel-a1", patch: { title } });
  const delta = store.delta(start + 1);
  assert.deepEqual(delta.records.map((record) => record.revision), [start + 2, start + 3]);
  assert.deepEqual(delta.events.map((event) => event.revision), [start + 2, start + 3]);
  assert.equal(delta.state, store.state);
  assert.deepEqual(store.delta(store.state.revision).records, []);
  const gone = store.delta(start - 2);
  assert.equal(gone.records, undefined);
  assert.equal(gone.state, store.state);
});

test("retained records are bounded in bytes, oldest first", () => {
  const store = workspace({ maxHistoryBytes: 4_000 });
  for (let index = 0; index < 60; index += 1)
    commit(store, { type: "panel.update", panelId: "panel-a1", patch: { title: `title ${index} ${"x".repeat(100)}` } });
  assert.equal(store.retainedHistoryBytes <= 4_000, true, String(store.retainedHistoryBytes));
  const newest = store.state.revision;
  assert.notEqual(store.recordAt(newest), undefined);
  assert.equal(store.recordAt(newest - 59), undefined);
});

test("a duplicated command id is answered from its outcome while that is remembered", () => {
  const store = workspace({ maxHistoryBytes: 4_000 });
  const command = { type: "panel.update", panelId: "panel-a1", patch: { title: "once" } };
  const first = store.apply({ commandId: "dup", command });
  const again = store.apply({ commandId: "dup", command: { ...command, patch: { title: "twice" } } });
  assert.equal(again.ok, true);
  assert.equal(again.revision, first.revision);
  assert.equal(again.event, first.event);
  assert.equal(store.state.revision, first.revision);
  assert.equal(store.state.panels["panel-a1"].title, "once");
  // A refusal is remembered too.
  const refused = store.apply({ commandId: "bad", command: { type: "panel.update", panelId: "nope", patch: { title: "x" } } });
  assert.equal(refused.ok, false);
  assert.deepEqual(store.apply({ commandId: "bad", command }), refused);
  // Once its record is dropped the id is new again.
  for (let index = 0; index < 60; index += 1)
    commit(store, { type: "panel.update", panelId: "panel-a2", patch: { title: `t ${index} ${"x".repeat(100)}` } });
  const later = store.apply({ commandId: "dup", command: { ...command, patch: { title: "later" } } });
  assert.equal(later.ok, true);
  assert.equal(later.revision > first.revision, true);
});

test("an outcome does not hold a copy of the state", () => {
  const store = workspace();
  const applied = store.apply({ commandId: "one", command: { type: "panel.update", panelId: "panel-a1", patch: { title: "one" } } });
  assert.equal(applied.state, store.state);
  commit(store, { type: "panel.update", panelId: "panel-a2", patch: { title: "two" } });
  // Replayed later, it answers with the state as it is now.
  assert.equal(store.apply({ commandId: "one", command: { type: "panel.close", panelId: "panel-a1" } }).state, store.state);
});
