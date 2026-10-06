import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient, WorkspaceClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  AgentStatusService,
  TerminalActivityService,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

/**
 * Moving a terminal panel to another project re-homes the live terminal with
 * it (ADR-0041): one `panel.move` from a client leaves every server component
 * agreeing that the terminal belongs to the target project.
 */

const SERVER = "move-server";
const encoder = new TextEncoder();

function createPtyFactory() {
  const ptys = [];
  return {
    ptys,
    spawn() {
      const pty = {
        pid: 43_000 + ptys.length,
        writes: [],
        dataListeners: new Set(),
        exitListeners: new Set(),
        write(bytes) { pty.writes.push(new Uint8Array(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { pty.dataListeners.add(listener); return () => pty.dataListeners.delete(listener); },
        onExit(listener) { pty.exitListeners.add(listener); return () => pty.exitListeners.delete(listener); },
        emit(text) { for (const listener of pty.dataListeners) listener(encoder.encode(text)); },
        exit(exitCode) { for (const listener of pty.exitListeners) listener({ exitCode, signal: null }); },
      };
      ptys.push(pty);
      return pty;
    },
  };
}

async function connect(composition, clientId) {
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["workspace.v1"] });
  await pair.open();
  await client.connect();
  return { client, serverTask };
}

async function setup(extra = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  for (const projectId of ["project-a", "project-b"])
    assert.equal(workspace.apply({ commandId: projectId, command: { type: "project.create", projectId, viewId, root: `/repo/${projectId}`, name: projectId } }).ok, true);
  const ptyFactory = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: SERVER });
  const agents = new AgentStatusService({ activity });
  await agents.start();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory,
    workspace,
    activity,
    agents,
    ...extra,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  return { workspace, composition, ptyFactory, activity, agents };
}

const identity = (projectId, sessionId) => ({ serverId: SERVER, projectId, sessionId });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const decode = (base64) => new TextDecoder().decode(Buffer.from(base64, "base64"));

async function close(composition, ...connections) {
  await Promise.all(connections.map((connection) => connection.client.close().catch(() => undefined)));
  await Promise.all(connections.map((connection) => connection.serverTask.catch(() => undefined)));
  await composition.shutdown();
}

test("a client panel move leaves every server component agreeing on the target project", async () => {
  const { workspace, composition, ptyFactory, activity, agents } = await setup();
  const mover = await connect(composition, "mover");
  try {
    const created = await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    const attached = await mover.client.command("terminal.attach", { identity: identity("project-a", sessionId), clientId: "mover", fromPosition: 0 }, { commandId: "attach-a" });
    ptyFactory.ptys[0].emit("long running output\r\n");
    await settle();
    const before = composition.terminal.getSession(sessionId);
    assert.equal(activity.projectIdForSession(sessionId), "project-a");

    await new WorkspaceClient(mover.client).movePanel({ panelId, targetProjectId: "project-b" });

    assert.equal(workspace.state.panels[panelId].projectId, "project-b");
    assert.equal(workspace.state.terminalSessions[sessionId].projectId, "project-b");
    const after = composition.terminal.getSession(sessionId);
    assert.equal(after.projectId, "project-b");
    assert.equal(after.outputPosition, before.outputPosition);
    assert.equal(ptyFactory.ptys.length, 1);

    assert.equal(activity.projectIdForSession(sessionId), "project-b");
    assert.equal(Object.hasOwn(activity.snapshotForProject("project-b").sessions, sessionId), true);
    assert.equal(Object.hasOwn(activity.snapshotForProject("project-a").sessions, sessionId), false);
    assert.equal(agents.isSessionActive(identity("project-b", sessionId)), true);
    assert.equal(agents.isSessionActive(identity("project-a", sessionId)), false);

    // The retired identity is refused; the attachment made under it is gone.
    await assert.rejects(mover.client.command("terminal.attach", { identity: identity("project-a", sessionId), clientId: "mover", fromPosition: 0 }, { commandId: "attach-retired" }));
    await assert.rejects(mover.client.command("terminal.input", { identity: identity("project-a", sessionId), attachmentId: attached.result.attachmentId, clientId: "mover", dataBase64: "eA==" }, { commandId: "input-retired" }));
    assert.equal(ptyFactory.ptys[0].writes.length, 0);

    const again = await mover.client.command("terminal.attach", { identity: identity("project-b", sessionId), clientId: "mover", fromPosition: 0 }, { commandId: "attach-b" });
    const replay = again.result.events.filter((event) => event.type === "output").map((event) => decode(event.bytes)).join("");
    assert.equal(replay, "long running output\r\n");

    // Activity keeps flowing under the new identity instead of being refused.
    ptyFactory.ptys[0].emit("more\r\n");
    await settle();
    assert.equal(composition.terminal.getSession(sessionId).outputPosition, before.outputPosition + "more\r\n".length);
  } finally {
    await close(composition, mover);
  }
});

test("a terminal moved away and back is owned by its original project again", async () => {
  const { workspace, composition, activity } = await setup();
  const mover = await connect(composition, "mover");
  try {
    const created = await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    const workspaceClient = new WorkspaceClient(mover.client);
    await workspaceClient.movePanel({ panelId, targetProjectId: "project-b" });
    await workspaceClient.movePanel({ panelId, targetProjectId: "project-a" });

    assert.equal(composition.terminal.getSession(sessionId).projectId, "project-a");
    assert.equal(activity.projectIdForSession(sessionId), "project-a");
    const attached = await mover.client.command("terminal.attach", { identity: identity("project-a", sessionId), clientId: "mover", fromPosition: 0 }, { commandId: "attach-a" });
    assert.equal(attached.result.presentation.role, "controller");
  } finally {
    await close(composition, mover);
  }
});

test("another client's attachment ends with the move and it attaches under the target project", async () => {
  const { workspace, composition, ptyFactory } = await setup();
  const mover = await connect(composition, "mover");
  const observer = await connect(composition, "observer");
  try {
    const created = await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    const observed = await observer.client.command("terminal.attach", { identity: identity("project-a", sessionId), clientId: "observer", fromPosition: 0 }, { commandId: "observe-a" });
    ptyFactory.ptys[0].emit("seen by both\r\n");
    await settle();

    await new WorkspaceClient(mover.client).movePanel({ panelId, targetProjectId: "project-b" });

    await assert.rejects(observer.client.command("terminal.ack", { identity: identity("project-a", sessionId), attachmentId: observed.result.attachmentId, clientId: "observer", position: 0 }, { commandId: "ack-retired" }));
    const again = await observer.client.command("terminal.attach", { identity: identity("project-b", sessionId), clientId: "observer", fromPosition: 0 }, { commandId: "observe-b" });
    const replay = again.result.events.filter((event) => event.type === "output").map((event) => decode(event.bytes)).join("");
    assert.equal(replay, "seen by both\r\n");
  } finally {
    await close(composition, mover, observer);
  }
});

test("an exited terminal's panel still moves, and the server keeps one answer for its project", async () => {
  const { workspace, composition, ptyFactory } = await setup();
  const mover = await connect(composition, "mover");
  try {
    const created = await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create" });
    const sessionId = created.result.sessionId;
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    ptyFactory.ptys[0].exit(0);
    await settle();
    if (workspace.state.panels[panelId] === undefined) return;

    await new WorkspaceClient(mover.client).movePanel({ panelId, targetProjectId: "project-b" });

    assert.equal(workspace.state.terminalSessions[sessionId].projectId, "project-b");
    const session = composition.terminal.getSession(sessionId);
    if (session !== undefined) assert.equal(session.projectId, "project-b");
  } finally {
    await close(composition, mover);
  }
});

test("an active recording follows its terminal, and a terminal that was never recorded gains no record", async () => {
  const recorded = new Set();
  const updates = [];
  const { workspace, composition } = await setup({
    recordings: {
      service: {
        appendOutput() {},
        finalize() {},
        shutdown() {},
        getSessionScope: (sessionId) => (recorded.has(sessionId) ? { sessionId, serverId: SERVER, projectId: "project-a" } : undefined),
        updateSessionMetadata: (sessionId, metadata) => updates.push([sessionId, metadata]),
      },
      operations: () => ({ queries: {}, commands: {}, policies: {} }),
    },
  });
  const mover = await connect(composition, "mover");
  try {
    const workspaceClient = new WorkspaceClient(mover.client);
    const panelFor = (sessionId) => Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    const first = (await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create-1" })).result.sessionId;
    const second = (await mover.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/project-a", cols: 80, rows: 24 }, { commandId: "create-2" })).result.sessionId;
    recorded.add(first);

    await workspaceClient.movePanel({ panelId: panelFor(first), targetProjectId: "project-b" });
    await workspaceClient.movePanel({ panelId: panelFor(second), targetProjectId: "project-b" });

    assert.deepEqual(updates, [[first, { projectId: "project-b" }]]);
  } finally {
    await close(composition, mover);
  }
});
