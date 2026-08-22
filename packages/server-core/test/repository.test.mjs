import test from "node:test";
import assert from "node:assert/strict";
import { THIS_SERVER_ENVIRONMENT_ID, WorkspaceRepository } from "../dist/index.js";

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

test("workspace repository durably commits a v2 environment migration exactly once", async () => {
  let persisted = {
    schemaVersion: 2, serverId: "server-a", revision: 0, cursor: "0", viewOrder: ["view-a"],
    views: { "view-a": { id: "view-a", serverId: "server-a", name: "Workspace", projectIds: ["project-a"], activeProjectId: "project-a" } },
    projects: { "project-a": { id: "project-a", serverId: "server-a", viewId: "view-a", root: "/tmp/a", rootOrigin: "legacy-unverified", name: "A", panelIds: [], layout: { kind: "stack", panelIds: [] } } },
    panels: {}, terminalSessions: {},
  };
  let commits = 0;
  const backend = { async load() { return structuredClone(persisted); }, async commit(state) { commits += 1; persisted = structuredClone(state); } };
  const first = new WorkspaceRepository(backend, "server-a");
  const migrated = await first.load();
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.projects["project-a"].projectEnvironmentId, THIS_SERVER_ENVIRONMENT_ID);
  assert.equal(commits, 1);
  const second = new WorkspaceRepository(backend, "server-a");
  assert.deepEqual(await second.load(), migrated);
  assert.equal(commits, 1);
});
