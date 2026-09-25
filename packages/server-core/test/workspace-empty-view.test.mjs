import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createWorkspaceOperationRegistry,
} from "../dist/index.js";

/**
 * A workspace view may hold no project: the main window shows Home when its
 * last project closes. Its next project is created in the server's default
 * folder, because there is no project left to take a folder from.
 */

const context = { authScope: "write", clientId: "c", connectionId: "k", signal: new AbortController().signal };

function command(registry, commandId, workspaceCommand) {
  return registry.operations.commands["workspace.command"]({
    body: new Uint8Array(),
    context,
    envelope: { commandId, operation: "workspace.command", payload: { command: workspaceCommand } },
  });
}

test("closing a view's only project leaves an empty view", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const registry = createWorkspaceOperationRegistry(store);
  const viewId = store.state.viewOrder[0];
  await command(registry, "create", { type: "project.create", projectId: "p1", viewId, root: "/tmp/p1" });
  await command(registry, "close", { type: "project.close", projectId: "p1" });
  assert.deepEqual(store.state.views[viewId].projectIds, []);
  assert.equal(store.state.views[viewId].activeProjectId, undefined);
});

test("a project created without a root uses the server's default folder", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const registry = createWorkspaceOperationRegistry(store, {
    defaultProjectRoot: async () => "/home/server",
  });
  const viewId = store.state.viewOrder[0];
  await command(registry, "create", { type: "project.create", projectId: "p1", viewId });
  const project = store.state.projects.p1;
  assert.equal(project.root, "/home/server");
  assert.equal(project.rootOrigin, "server-default");
  assert.deepEqual(store.state.views[viewId].projectIds, ["p1"]);
});

test("a project that names its root keeps it", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const registry = createWorkspaceOperationRegistry(store, {
    defaultProjectRoot: async () => "/home/server",
  });
  const viewId = store.state.viewOrder[0];
  await command(registry, "create", { type: "project.create", projectId: "p1", viewId, root: "/srv/app" });
  assert.equal(store.state.projects.p1.root, "/srv/app");
  assert.equal(store.state.projects.p1.rootOrigin, "explicit");
});

test("without a default folder a rootless project is refused", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const registry = createWorkspaceOperationRegistry(store, {
    defaultProjectRoot: async () => null,
  });
  const viewId = store.state.viewOrder[0];
  await assert.rejects(
    command(registry, "create", { type: "project.create", projectId: "p1", viewId }),
    (error) => /project root is required/.test(JSON.stringify(error) + String(error?.message)),
  );
  assert.equal(store.state.projects.p1, undefined);
});
