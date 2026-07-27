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
  assert.deepEqual(calls, [["backup", 0], ["commit", 1]]);
  const conflict = await repository.apply({ commandId: "stale", expectedRevision: 0, command: { type: "view.rename", viewId, name: "Old" } });
  assert.equal(conflict.ok, false);
  assert.equal(repository.state.revision, 1);
});
