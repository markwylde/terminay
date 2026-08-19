import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceClient, TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn() {
      const exitListeners = new Set();
      const process = {
        pid: 30_000 + processes.length,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitExit(exit = { exitCode: 0, signal: null }) {
          for (const listener of exitListeners) listener(exit);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

async function connect(composition, clientId) {
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["workspace"] });
  await pair.open();
  await client.connect();
  return { client, pair, serverTask };
}

test("protocol terminal creation registers its project and session with the workspace authority", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("terminal-workspace-server"));
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "terminal-workspace-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const connected = await connect(composition, "terminal-workspace-client");
  try {
    const created = await connected.client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    }, { commandId: "create-terminal-a" });

    assert.equal(workspace.state.projects["project-a"].root, "/repo/a");
    assert.equal(workspace.state.terminalSessions[created.result.sessionId].projectId, "project-a");
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("a terminal panel created by one client converges to a second client with identical panel and session ids", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("two-client-workspace-server"));
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "two-client-workspace-server",
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const creator = await connect(composition, "creator-client");
  const observer = await connect(composition, "observer-client");
  const subscription = await observer.client.subscribe("workspace.changed");
  const observedRevision = new Promise((resolve) => {
    subscription.onEvent((event) => { if (event.payload.revision >= 2) resolve(event.payload.revision); });
  });
  try {
    const before = await new WorkspaceClient(observer.client).snapshot();
    const created = await creator.client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    }, { commandId: "create-shared-terminal" });
    const revision = await observedRevision;
    const observed = await new WorkspaceClient(observer.client).delta(before.revision, before.cursor);
    const panel = Object.values(observed.state.panels).find((candidate) => candidate.sessionId === created.result.sessionId);
    assert.equal(revision, observed.revision);
    assert.equal(panel.id, `p:${created.result.sessionId}`);
    assert.equal(panel.sessionId, created.result.sessionId);
    assert.equal(observed.state.terminalSessions[created.result.sessionId].id, created.result.sessionId);
  } finally {
    await subscription.unsubscribe().catch(() => undefined);
    await Promise.all([creator.client.close().catch(() => undefined), observer.client.close().catch(() => undefined)]);
    await Promise.all([creator.serverTask.catch(() => undefined), observer.serverTask.catch(() => undefined)]);
    await composition.shutdown();
  }
});

test("authenticated WorkspaceClient project.move commits through the real server transport and preserves panel/session identity", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("move-server"));
  const defaultViewId = workspace.state.viewOrder[0];
  assert.ok(defaultViewId);
  assert.equal(workspace.apply({ commandId: "view-target", expectedRevision: 0, command: { type: "view.create", viewId: "view-target", name: "Target" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "project-create", expectedRevision: 1, command: { type: "project.create", projectId: "project-a", viewId: defaultViewId, root: "/repo/a", name: "A" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "session-create", expectedRevision: 2, command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 } }).ok, true);
  assert.equal(workspace.apply({ commandId: "panel-create", expectedRevision: 3, command: { type: "panel.create", panel: { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "session-a", createdAt: 1 } } }).ok, true);

  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "move-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const connected = await connect(composition, "move-client");
  try {
    const workspaceClient = new WorkspaceClient(connected.client);
    const result = await workspaceClient.moveProject(
      { projectId: "project-a", targetViewId: "view-target", index: 0 },
      { commandId: "move-project-a", expectedRevision: 4 },
    );
    assert.deepEqual(result, { projectId: "project-a", revision: 5, cursor: "5" });
    assert.equal(composition.workspace.state.projects["project-a"].viewId, "view-target");
    assert.deepEqual(composition.workspace.state.projects["project-a"].panelIds, ["panel-a"]);
    assert.equal(composition.workspace.state.panels["panel-a"].sessionId, "session-a");
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("project.move is denied to an authenticated read client", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("move-auth-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.ok(viewId);
  assert.equal(workspace.apply({ commandId: "project-create", expectedRevision: 0, command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" } }).ok, true);
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "move-auth-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  const connected = await connect(composition, "read-client");
  try {
    await assert.rejects(
      () => new WorkspaceClient(connected.client).moveProject({ projectId: "project-a", targetViewId: viewId }, { commandId: "denied-move", expectedRevision: 1 }),
      (error) => error?.code === "forbidden",
    );
    assert.equal(composition.workspace.state.revision, 1);
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("project.root.update atomically commits canonical catalog binding and workspace delta", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("root-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "project-a", expectedRevision: 0, command: { type: "project.create", projectId: "project-a", viewId, root: "/old/a", name: "A" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "project-b", expectedRevision: 1, command: { type: "project.create", projectId: "project-b", viewId, root: "/old/b", name: "B" } }).ok, true);
  const catalogRoots = new Map([["project-a", "/old/a"], ["project-b", "/old/b"]]);
  const prepared = [];
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "root-server",
    serverVersion: "test",
    capabilities: ["workspace", "files"],
    ptyFactory: createPtyFactory(),
    workspace,
    workspaceOperations: {
      async prepareProjectRootUpdate(projectId, root) {
        prepared.push({ projectId, root });
        if (!root.startsWith("/canonical/")) throw new Error("root is not canonical");
        return {
          canonicalRoot: root,
          commit: () => { catalogRoots.set(projectId, root); },
        };
      },
    },
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: "write",
      claims: { projectId: hello.clientId === "project-b-client" ? "project-b" : "project-a" },
    }),
  });
  const projectA = await connect(composition, "project-a-client");
  const projectB = await connect(composition, "project-b-client");
  try {
    const clientA = new WorkspaceClient(projectA.client);
    const updated = await clientA.updateProjectRoot({
      projectId: "project-a",
      root: "/canonical/a",
      expectedRevision: 2,
    }, { commandId: "root-a" });
    assert.deepEqual(updated, { projectId: "project-a", root: "/canonical/a", revision: 3, cursor: "3" });
    assert.equal(workspace.state.projects["project-a"].root, "/canonical/a");
    assert.equal(catalogRoots.get("project-a"), "/canonical/a");
    const delta = await projectA.client.query("workspace.delta", { revision: 2, cursor: "2" });
    assert.equal(delta.result.state.projects["project-a"].root, "/canonical/a");
    assert.equal(delta.result.events.at(-1).type, "project.root.update");

    await assert.rejects(
      () => clientA.updateProjectRoot({ projectId: "project-a", root: "/canonical/stale", expectedRevision: 2 }, { commandId: "root-stale" }),
      (error) => error?.code === "conflict",
    );
    assert.equal(prepared.some(({ root }) => root === "/canonical/stale"), false);
    assert.equal(catalogRoots.get("project-a"), "/canonical/a");

    await assert.rejects(
      () => projectA.client.command("workspace.command", {
        command: { type: "project.root.update", projectId: "project-a", root: "/canonical/bypass" },
      }, { commandId: "root-generic-bypass", expectedRevision: 3 }),
      (error) => error?.code === "validation",
    );
    assert.equal(workspace.state.projects["project-a"].root, "/canonical/a");

    await assert.rejects(
      () => clientA.updateProjectRoot({ projectId: "project-a", root: "/invalid/a", expectedRevision: 3 }, { commandId: "root-invalid" }),
      (error) => error?.code === "validation",
    );
    assert.equal(workspace.state.revision, 3);
    assert.equal(catalogRoots.get("project-a"), "/canonical/a");

    await assert.rejects(
      () => new WorkspaceClient(projectB.client).updateProjectRoot({ projectId: "project-a", root: "/canonical/cross", expectedRevision: 3 }, { commandId: "root-cross" }),
      (error) => error?.code === "forbidden",
    );
    assert.equal(prepared.some(({ root }) => root === "/canonical/cross"), false);
    assert.equal(workspace.state.revision, 3);
  } finally {
    await projectA.client.close().catch(() => undefined);
    await projectB.client.close().catch(() => undefined);
    await Promise.all([projectA.serverTask.catch(() => undefined), projectB.serverTask.catch(() => undefined)]);
    await composition.shutdown();
  }
});

test("project-scoped workspace queries never disclose sibling project or terminal identities", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("scope-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.ok(viewId);
  for (const command of [
    { commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" } },
    { commandId: "project-b", command: { type: "project.create", projectId: "project-b", viewId, root: "/private/b", name: "B" } },
    { commandId: "session-a", command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 } },
    { commandId: "session-b", command: { type: "terminal.create", sessionId: "session-b", projectId: "project-b", createdAt: 1 } },
  ]) assert.equal(workspace.apply({ ...command, expectedRevision: workspace.state.revision }).ok, true);
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "scope-server", serverVersion: "test", capabilities: ["workspace"], ptyFactory: createPtyFactory(), workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read", claims: { projectId: "project-a" } }),
  });
  const connected = await connect(composition, "scoped-client");
  try {
    const client = new WorkspaceClient(connected.client);
    const snapshot = await client.snapshot();
    const delta = await client.delta(0, "0");
    for (const value of [snapshot, delta.state]) {
      assert.deepEqual(Object.keys(value.projects), ["project-a"]);
      assert.deepEqual(Object.keys(value.terminalSessions), ["session-a"]);
      assert.equal(JSON.stringify(value).includes("project-b"), false);
      assert.equal(JSON.stringify(value).includes("/private/b"), false);
      assert.equal(JSON.stringify(value).includes("session-b"), false);
    }
	const rawDelta = await connected.client.query("workspace.delta", { revision: 0, cursor: "0" });
	assert.equal(JSON.stringify(rawDelta.result.events).includes("project-b"), false);
	assert.equal(JSON.stringify(rawDelta.result.events).includes("session-b"), false);
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("a PTY exit marks the workspace session exited without removing its panel", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("exit-workspace-server"));
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "exit-workspace-server",
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory: pty,
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const connected = await connect(composition, "exit-workspace-client");
  try {
    const created = await connected.client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    }, { commandId: "create-exiting-terminal" });
    assert.equal(workspace.state.terminalSessions[created.result.sessionId].status, "running");
    pty.processes[0].emitExit({ exitCode: 0, signal: null });
    assert.equal(workspace.state.terminalSessions[created.result.sessionId].status, "exited");
    assert.equal(workspace.state.terminalSessions[created.result.sessionId].exitCode, 0);
    const panel = Object.values(workspace.state.panels).find((candidate) => candidate.sessionId === created.result.sessionId);
    assert.equal(panel?.type, "terminal");
  } finally {
    await connected.client.close().catch(() => undefined);
    await connected.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});
