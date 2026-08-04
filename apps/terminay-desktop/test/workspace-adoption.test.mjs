import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "@terminay/server-core";
import { WorkspaceClient } from "@terminay/client-core";
import { ConnectionProfileStore, DesktopConnectionHost } from "../dist/main/index.js";

function ptyFactory() {
  return {
    spawn() {
      return {
        pid: 30_001,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit() { return () => {}; },
      };
    },
  };
}

async function createAdoptionFixture() {
  const workspace = new WorkspaceStore(createInitialWorkspace("desktop-adoption"));
  const sourceViewId = workspace.state.viewOrder[0];
  assert.ok(sourceViewId);
  assert.equal(workspace.apply({ commandId: "create-target-view", expectedRevision: 0, command: { type: "view.create", viewId: "view-target", name: "Target" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "create-project", expectedRevision: 1, command: { type: "project.create", projectId: "project-adopted", viewId: sourceViewId, root: "/repo/adopted", name: "Adopted" } }).ok, true);
  assert.equal(workspace.apply({ commandId: "create-session", expectedRevision: 2, command: { type: "terminal.create", sessionId: "session-adopted", projectId: "project-adopted", createdAt: 1 } }).ok, true);
  assert.equal(workspace.apply({ commandId: "create-panel", expectedRevision: 3, command: { type: "panel.create", panel: { id: "panel-adopted", projectId: "project-adopted", type: "terminal", sessionId: "session-adopted", createdAt: 1 } } }).ok, true);

  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "desktop-adoption",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: ptyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  let pair;
  let serverTask;
  const localServer = {
    state: "created",
    async start() {
      pair = createInMemoryTransportPair();
      serverTask = composition.core.accept(pair.server).start();
      await pair.open();
      this.state = "ready";
      return { serverId: "desktop-adoption", origin: "http://127.0.0.1:4901", transport: pair.client };
    },
    async stop() {
      this.state = "stopped";
      await composition.shutdown();
      await serverTask?.catch(() => undefined);
    },
  };
  const host = new DesktopConnectionHost({ localServer, profiles: new ConnectionProfileStore() });
  return { host, workspace, sourceViewId, localServer };
}

test("Desktop project adoption moves the canonical project and rebinds one native view", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-adoption-window" });
    const result = await host.adoptProjectWindow("local:desktop-adoption", {
      projectId: "project-adopted",
      targetViewId: "view-target",
      currentWindowId: "native-adoption-window",
      rebindCurrent: true,
      commandId: "adopt-project",
      expectedRevision: 4,
    });

    assert.deepEqual(result.move, { projectId: "project-adopted", revision: 5, cursor: "5" });
    assert.equal(result.selection.action, "open");
    assert.deepEqual(host.windows.list(), [{ windowId: "native-adoption-window", connectionId: "local:desktop-adoption", workspaceViewId: "view-target" }]);
    assert.equal(workspace.state.projects["project-adopted"].viewId, "view-target");
    assert.deepEqual(workspace.state.views[sourceViewId].projectIds, []);
    assert.deepEqual(workspace.state.views["view-target"].projectIds, ["project-adopted"]);
    assert.deepEqual(workspace.state.projects["project-adopted"].panelIds, ["panel-adopted"]);
    assert.equal(workspace.state.panels["panel-adopted"].projectId, "project-adopted");
    assert.equal(workspace.state.panels["panel-adopted"].sessionId, "session-adopted");
    assert.deepEqual(Object.keys(workspace.state.projects), ["project-adopted"]);
    assert.deepEqual(Object.keys(workspace.state.panels), ["panel-adopted"]);
    assert.deepEqual(Object.keys(workspace.state.terminalSessions), ["session-adopted"]);
  } finally {
    await host.stop();
  }
});

test("Desktop project popout creates a server view, moves the project, and opens one native window", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-source-window" });
    const result = await host.popoutProjectWindow("local:desktop-adoption", {
      projectId: "project-adopted",
      targetViewId: "view-popout",
      targetViewName: "Popout",
      createWindowId: () => "native-popout-window",
      createViewCommandId: "popout-create-view",
      commandId: "popout-move-project",
      expectedRevision: 4,
    });

    assert.deepEqual(result.view, { viewId: "view-popout", revision: 5, cursor: "5" });
    assert.deepEqual(result.move, { projectId: "project-adopted", revision: 6, cursor: "6" });
    assert.equal(result.selection.action, "open");
    assert.deepEqual(host.windows.list(), [
      { windowId: "native-source-window", connectionId: "local:desktop-adoption", workspaceViewId: sourceViewId },
      { windowId: "native-popout-window", connectionId: "local:desktop-adoption", workspaceViewId: "view-popout" },
    ]);
    assert.equal(workspace.state.projects["project-adopted"].viewId, "view-popout");
    assert.deepEqual(workspace.state.views[sourceViewId].projectIds, []);
    assert.deepEqual(workspace.state.views["view-popout"].projectIds, ["project-adopted"]);
    assert.deepEqual(workspace.state.projects["project-adopted"].panelIds, ["panel-adopted"]);
    assert.equal(workspace.state.panels["panel-adopted"].sessionId, "session-adopted");
    assert.deepEqual(Object.keys(workspace.state.terminalSessions), ["session-adopted"]);
  } finally {
    await host.stop();
  }
});

test("failed project popout rolls back native binding and the empty created server view", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-source-window" });

    await assert.rejects(
      host.popoutProjectWindow("local:desktop-adoption", {
        projectId: "missing-project",
        targetViewId: "view-popout",
        targetViewName: "Popout",
        createWindowId: () => "native-popout-window",
        createViewCommandId: "failed-popout-create-view",
        commandId: "failed-popout-move-project",
        rollbackViewCommandId: "failed-popout-close-view",
        expectedRevision: 4,
      }),
      (error) => error?.code === "conflict",
    );

    assert.deepEqual(host.windows.list(), [{ windowId: "native-source-window", connectionId: "local:desktop-adoption", workspaceViewId: sourceViewId }]);
    assert.equal(workspace.state.views["view-popout"], undefined);
    assert.equal(workspace.state.projects["project-adopted"].viewId, sourceViewId);
    assert.equal(workspace.state.revision, 6);
  } finally {
    await host.stop();
  }
});

test("rejected project adoption restores the prior native binding", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-adoption-window" });
    await assert.rejects(
      host.adoptProjectWindow("local:desktop-adoption", {
        projectId: "project-adopted",
        targetViewId: "view-target",
        currentWindowId: "native-adoption-window",
        rebindCurrent: true,
        commandId: "adopt-stale-project",
        expectedRevision: 3,
      }),
      (error) => error?.code === "conflict",
    );
    assert.deepEqual(host.windows.list(), [{ windowId: "native-adoption-window", connectionId: "local:desktop-adoption", workspaceViewId: sourceViewId }]);
    assert.equal(workspace.state.projects["project-adopted"].viewId, sourceViewId);
    assert.equal(workspace.state.revision, 4);
  } finally {
    await host.stop();
  }
});

test("explicit logical-view close uses the server command and detaches only that view", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-source-window" });
    await host.openProfileWindow("local:desktop-adoption", "view-target", { createWindowId: () => "native-target-window" });

    const result = await host.closeWorkspaceView("local:desktop-adoption", {
      viewId: "view-target",
      commandId: "close-target-view",
      expectedRevision: 4,
    });

    assert.deepEqual(result.command, { revision: 5, cursor: "5" });
    assert.deepEqual(result.detachedBindings, [{ windowId: "native-target-window", connectionId: "local:desktop-adoption", workspaceViewId: "view-target" }]);
    assert.deepEqual(host.windows.list(), [{ windowId: "native-source-window", connectionId: "local:desktop-adoption", workspaceViewId: sourceViewId }]);
    assert.deepEqual(workspace.state.viewOrder, [sourceViewId]);
    assert.equal(host.getConnection("local:desktop-adoption")?.client.state, "connected");
  } finally {
    await host.stop();
  }
});

test("rejected logical-view close leaves native bindings intact", async () => {
  const fixture = await createAdoptionFixture();
  const { host, workspace, sourceViewId } = fixture;
  try {
    await host.openInitialWindow({ workspaceViewId: sourceViewId, createWindowId: () => "native-source-window" });
    await host.openProfileWindow("local:desktop-adoption", "view-target", { createWindowId: () => "native-target-window" });

    await assert.rejects(
      host.closeWorkspaceView("local:desktop-adoption", { viewId: "view-target", commandId: "stale-close-target-view", expectedRevision: 3 }),
      (error) => error?.code === "conflict",
    );
    assert.deepEqual(host.windows.list().map(({ windowId, workspaceViewId }) => ({ windowId, workspaceViewId })), [
      { windowId: "native-source-window", workspaceViewId: sourceViewId },
      { windowId: "native-target-window", workspaceViewId: "view-target" },
    ]);
    assert.equal(workspace.state.viewOrder.includes("view-target"), true);
  } finally {
    await host.stop();
  }
});

test("WorkspaceClient exposes a typed logical-view close operation", async () => {
  const calls = [];
  const viewCommands = new WorkspaceClient({
    async command(operation, payload, options) {
      calls.push({ operation, payload, options });
      return { result: { revision: 9, cursor: "9" } };
    },
  });

  const result = await viewCommands.closeView("view-target", {
    commandId: "typed-view-close",
    expectedRevision: 8,
  });

  assert.deepEqual(result, { revision: 9, cursor: "9" });
  assert.deepEqual(calls, [{
    operation: "workspace.command",
    payload: { command: { type: "view.close", viewId: "view-target" } },
    options: { commandId: "typed-view-close", expectedRevision: 8 },
  }]);
});
