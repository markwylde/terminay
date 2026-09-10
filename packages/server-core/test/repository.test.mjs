import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRepository } from "../dist/index.js";

test("workspace repository migrates, backs up before commit, and keeps revision conflicts explicit", async () => {
  let persisted;
  const calls = [];
  const repository = new WorkspaceRepository({
    async load() { return persisted; },
    async backup(state) { calls.push(["backup", state.revision]); },
    async commit(state) { calls.push(["commit", state.revision]); persisted = state; },
  }, "server-a");
  const initial = await repository.load();
  const viewId = initial.viewOrder[0];
  const result = await repository.apply({ commandId: "project", expectedRevision: 0, command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["commit", 0], ["backup", 0], ["commit", 1]]);
  const conflict = await repository.apply({ commandId: "stale", expectedRevision: 0, command: { type: "view.rename", viewId, name: "Old" } });
  assert.equal(conflict.ok, false);
  assert.equal(repository.state.revision, 1);
});

test("a previous-version repository is preserved and reported unreadable", async () => {
  const previous = {
    schemaVersion: 4, serverId: "server-a", revision: 0, cursor: "0", viewOrder: ["view-a"],
    views: { "view-a": { id: "view-a", serverId: "server-a", name: "Workspace", projectIds: ["project-a"], activeProjectId: "project-a" } },
    projects: { "project-a": { id: "project-a", serverId: "server-a", viewId: "view-a", projectEnvironmentId: "terminay:this-server", environmentRevision: 1, root: "/tmp/a", rootOrigin: "legacy-unverified", name: "A", panelIds: [], layout: { kind: "stack", panelIds: [] } } },
    panels: {}, terminalSessions: {},
  };
  let persisted = structuredClone(previous);
  let commits = 0;
  const backend = { async load() { return structuredClone(persisted); }, async commit(state) { commits += 1; persisted = structuredClone(state); } };
  const repository = new WorkspaceRepository(backend, "server-a");
  await assert.rejects(repository.load(), (error) => {
    assert.equal(error.code, "persistence_invalid");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(commits, 0);
  assert.deepEqual(persisted, previous);
});
