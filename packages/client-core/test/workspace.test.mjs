import test from "node:test";
import assert from "node:assert/strict";
import { ClientError, WorkspaceClient } from "../dist/index.js";

test("workspace facade keeps panel activation on the canonical server operation", async () => {
  const calls = [];
  const fake = {
    async query(operation, payload) { calls.push([operation, payload]); return { result: operation === "workspace.delta" ? { state: { schemaVersion: 1, serverId: "server-a", revision: 3, cursor: "3" }, events: [] } : { schemaVersion: 1, serverId: "server-a", revision: 2, cursor: "2" } }; },
    async command(operation, payload) { calls.push([operation, payload]); return { result: { revision: 3 } }; },
  };
  const workspace = new WorkspaceClient(fake);
  assert.equal((await workspace.snapshot()).cursor, "2");
  assert.equal((await workspace.delta(2, "2")).cursor, "3");
  await workspace.activatePanel({ projectId: "project-a", panelId: "panel-a" });
  assert.deepEqual(calls.map(([operation]) => operation), ["workspace.snapshot", "workspace.delta", "workspace.command"]);
  assert.deepEqual(calls[2][1], { command: { type: "panel.activate", projectId: "project-a", panelId: "panel-a" } });
});

test("workspace facade rejects unbounded panel activation identities before transport", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async query() { throw new Error("not reached"); },
    async command(operation, payload) { calls.push([operation, payload]); return { result: null }; },
  });

  await assert.rejects(workspace.activatePanel({ projectId: "project-a", panelId: "not a panel id" }), /panel activation ids are invalid/);
  assert.deepEqual(calls, []);
});

test("workspace facade commits a bounded terminal tab order through canonical state", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async command(operation, payload) { calls.push([operation, payload]); return { result: null }; },
  });

  await workspace.reorderPanels({ projectId: "project-a", panelIds: ["panel-b", "panel-a"] });
  assert.deepEqual(calls, [[
    "workspace.command",
    { command: { type: "panel.reorder", projectId: "project-a", panelIds: ["panel-b", "panel-a"] } },
  ]]);
  await assert.rejects(
    workspace.reorderPanels({ projectId: "project-a", panelIds: ["panel-a", "panel-a"] }),
    /panel reorder ids are invalid/,
  );
  assert.equal(calls.length, 1);
});

test("workspace facade exposes bounded project and panel lifecycle operations", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async command(operation, payload) { calls.push([operation, payload]); return { result: null }; },
  });
  await workspace.createProject({ projectId: "project-mobile", viewId: "view-mobile", root: "/workspace/mobile", name: "Mobile" });
  await workspace.createPanel({ panel: { id: "panel-mobile", projectId: "project-mobile", type: "file", path: "README.md", createdAt: 1 } });
  await workspace.activatePanel({ projectId: "project-mobile", panelId: "panel-mobile" });
  await workspace.movePanel({ panelId: "panel-mobile", targetProjectId: "project-archive", index: 0 });
  await workspace.closePanel("panel-mobile");
  await workspace.closeProject("project-mobile");
  assert.deepEqual(calls.map(([, payload]) => payload.command.type), [
    "project.create",
    "panel.create",
    "panel.activate",
    "panel.move",
    "panel.close",
    "project.close",
  ]);
  await assert.rejects(workspace.createProject({ projectId: "bad id", viewId: "view-mobile", root: "/workspace", name: "Bad" }), /project create request is invalid/);
  await assert.rejects(workspace.closeProject("bad id"), /project close id is invalid/);
  assert.equal(calls.length, 6);
});

test("workspace facade activates projects through canonical workspace state", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async command(operation, payload) { calls.push([operation, payload]); return { result: null }; },
  });

  await workspace.activateProject({ projectId: "project-a" });
  assert.deepEqual(calls, [[
    "workspace.command",
    { command: { type: "project.activate", projectId: "project-a" } },
  ]]);
  await assert.rejects(workspace.activateProject({ projectId: "bad id" }), /project activation id is invalid/);
  assert.equal(calls.length, 1);
});

test("workspace delta accepts only the canonical revision cursor and snapshot shape", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async query(operation, payload) {
      calls.push([operation, payload]);
      return { result: { state: { schemaVersion: 1, serverId: "server-a", revision: 4, cursor: "3" }, events: [] } };
    },
    async command() { throw new Error("not reached"); },
  });

  await assert.rejects(workspace.delta(3, "legacy-cursor"), /workspace delta cursor is invalid/);
  await assert.rejects(workspace.delta(-1, "-1"), /workspace delta cursor is invalid/);
  assert.deepEqual(calls, []);

  await assert.rejects(workspace.delta(3, "3"), /invalid workspace snapshot/);
  assert.deepEqual(calls, [["workspace.delta", { revision: 3, cursor: "3" }]]);
});

test("workspace facade binds a project move acknowledgement to its canonical request identity", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async query() { throw new Error("not reached"); },
    async command(operation, payload) {
      calls.push([operation, payload]);
      return { result: { projectId: "project-b", revision: 4, cursor: "4" } };
    },
  });

  await assert.rejects(
    workspace.moveProject({ projectId: "project-a", targetViewId: "view-b", index: 0 }),
    /project move response identity is invalid/,
  );
  assert.deepEqual(calls, [["project.move", { projectId: "project-a", targetViewId: "view-b", index: 0 }]]);
});

test("workspace root update reports an older peer as precisely incompatible", async () => {
  const workspace = new WorkspaceClient({
    async command(operation) {
      assert.equal(operation, "project.root.update");
      throw new ClientError("not_found", "unknown command operation");
    },
  });

  await assert.rejects(
    workspace.updateProjectRoot({ projectId: "project-a", root: "/repo/a", expectedRevision: 2 }),
    (error) => error instanceof ClientError
      && error.code === "incompatible"
      && error.message === "connected server does not support project root updates"
      && error.cause?.code === "not_found",
  );
});

test("workspace view adapters expose only typed create and close operations", async () => {
  const calls = [];
  const workspace = new WorkspaceClient({
    async command(operation, payload, options) {
      calls.push({ operation, payload, options });
      return { result: { revision: calls.length, cursor: String(calls.length) } };
    },
  });

  assert.deepEqual(await workspace.createView({ viewId: "view-a", name: "A" }, { commandId: "create-view" }), { revision: 1, cursor: "1" });
  assert.deepEqual(await workspace.closeView("view-a", { commandId: "close-view" }), { revision: 2, cursor: "2" });
  assert.equal("command" in workspace, false);
  assert.deepEqual(calls.map(({ operation, payload }) => ({ operation, payload })), [
    { operation: "workspace.command", payload: { command: { type: "view.create", viewId: "view-a", name: "A" } } },
    { operation: "workspace.command", payload: { command: { type: "view.close", viewId: "view-a" } } },
  ]);
  await assert.rejects(workspace.createView({ viewId: "view-a", name: "\n" }), /workspace view create request is invalid/);
});
