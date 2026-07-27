import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceClient } from "../dist/index.js";

test("workspace facade uses canonical snapshot/delta/command operation names", async () => {
  const calls = [];
  const fake = {
    async query(operation, payload) { calls.push([operation, payload]); return { result: { schemaVersion: 1, serverId: "server-a", revision: 2, cursor: "2" } }; },
    async command(operation, payload) { calls.push([operation, payload]); return { result: { revision: 3 } }; },
  };
  const workspace = new WorkspaceClient(fake);
  assert.equal((await workspace.snapshot()).cursor, "2");
  await workspace.delta(2, "2");
  await workspace.command({ type: "project.rename", projectId: "project-a", name: "A" });
  assert.deepEqual(calls.map(([operation]) => operation), ["workspace.snapshot", "workspace.delta", "workspace.command"]);
});
