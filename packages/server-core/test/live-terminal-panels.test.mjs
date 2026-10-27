import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient, WorkspaceClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
  generalFolderId,
} from "../dist/index.js";

/**
 * A running terminal always has a panel. One the workspace lost — a closed
 * tab whose shell outlived its kill, or a session spawned without one — is
 * given a panel in its project's General folder, so nothing runs unseen.
 */

const SERVER = "live-panel-server";
const GRACE_MS = 30;

function createPtyFactory() {
  const ptys = [];
  return {
    ptys,
    spawn() {
      const pty = {
        pid: 51_000 + ptys.length,
        killed: 0,
        exitListeners: new Set(),
        write() {},
        resize() {},
        // A shell that ignores the signal it is sent.
        kill() { pty.killed += 1; },
        onData() { return () => {}; },
        onExit(listener) { pty.exitListeners.add(listener); return () => pty.exitListeners.delete(listener); },
        exit(exitCode) { for (const listener of pty.exitListeners) listener({ exitCode, signal: null }); },
      };
      ptys.push(pty);
      return pty;
    },
  };
}

async function setup() {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  for (const projectId of ["project-a", "project-b"])
    assert.equal(workspace.apply({ commandId: projectId, command: { type: "project.create", projectId, viewId, root: `/repo/${projectId}`, name: projectId } }).ok, true);
  const ptyFactory = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory,
    workspace,
    liveTerminalPanelGraceMs: GRACE_MS,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId: "client", capabilities: ["workspace.v1"] });
  await pair.open();
  await client.connect();
  return {
    workspace,
    composition,
    ptyFactory,
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
      await composition.shutdown();
    },
  };
}

const panelsOf = (workspace, sessionId) =>
  Object.values(workspace.state.panels).filter((panel) => panel.type === "terminal" && panel.sessionId === sessionId);

const touch = (workspace, name) => {
  const result = workspace.apply({ commandId: `touch-${name}`, command: { type: "project.rename", projectId: "project-b", name } });
  assert.equal(result.ok, true);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4));

test("a closed tab whose shell is still running comes back in General", async () => {
  const { workspace, client, composition, close } = await setup();
  try {
    const created = await client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    const [panel] = panelsOf(workspace, sessionId);
    await new WorkspaceClient(client).closePanel(panel.id);
    assert.equal(panelsOf(workspace, sessionId).length, 0);
    assert.equal(composition.terminal.getSession(sessionId).status, "running");

    await settle();

    const shown = panelsOf(workspace, sessionId);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].projectId, "project-a");
    assert.equal(shown[0].folderId, generalFolderId(workspace.state, "project-a"));
    assert.equal(workspace.state.terminalSessions[sessionId]?.projectId, "project-a");
  } finally {
    await close();
  }
});

test("a terminal spawned without a panel is given one in General, wherever General sits", async () => {
  const { workspace, composition, close } = await setup();
  try {
    const general = generalFolderId(workspace.state, "project-a");
    assert.equal(workspace.apply({ commandId: "folder", command: { type: "folder.create", projectId: "project-a", folderId: "folder-x", name: "Work" } }).ok, true);
    const order = [...workspace.state.projects["project-a"].folderIds].reverse();
    assert.equal(workspace.apply({ commandId: "reorder", command: { type: "folder.reorder", projectId: "project-a", folderIds: order } }).ok, true);
    assert.notEqual(workspace.state.projects["project-a"].folderIds[0], general);

    const handle = await composition.terminal.createSession({ projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 });
    const { sessionId } = handle.snapshot();
    touch(workspace, "first");
    await settle();

    const shown = panelsOf(workspace, sessionId);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].folderId, general);
    assert.match(shown[0].defaultTitle, /^Terminal \d+$/u);
  } finally {
    await close();
  }
});

test("a terminal that gets its panel within the grace is not given a second one", async () => {
  const { workspace, client, close } = await setup();
  try {
    const created = await client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    touch(workspace, "again");
    await settle();
    assert.equal(panelsOf(workspace, sessionId).length, 1);
  } finally {
    await close();
  }
});

test("a terminal that exits during the grace is not given a panel", async () => {
  const { workspace, composition, ptyFactory, close } = await setup();
  try {
    const handle = await composition.terminal.createSession({ projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 });
    const { sessionId } = handle.snapshot();
    touch(workspace, "exit");
    ptyFactory.ptys.at(-1).exit(0);
    await settle();
    assert.equal(panelsOf(workspace, sessionId).length, 0);
  } finally {
    await close();
  }
});

test("a running terminal whose project is gone is ended, not shown", async () => {
  const { workspace, composition, ptyFactory, close } = await setup();
  try {
    const handle = await composition.terminal.createSession({ projectId: "project-b", cwd: "/repo/project-b", cols: 80, rows: 24 });
    const { sessionId } = handle.snapshot();
    const pty = ptyFactory.ptys.at(-1);
    assert.equal(workspace.apply({ commandId: "close-b", command: { type: "project.close", projectId: "project-b" } }).ok, true);
    await settle();
    assert.equal(panelsOf(workspace, sessionId).length, 0);
    assert.ok(pty.killed > 0);
  } finally {
    await close();
  }
});
