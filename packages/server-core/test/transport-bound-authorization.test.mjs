import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createServerCore,
  createServerCoreComposition,
} from "../dist/index.js";

function ptyFactory() {
  return { spawn: () => ({ pid: 1, write() {}, resize() {}, kill() {}, onData: () => () => {}, onExit: () => () => {} }) };
}

async function connected(core, clientId) {
  const pair = createInMemoryTransportPair();
  const connection = core.accept(pair.server, {
    authenticatedClient: { clientId: "device-authority", authScope: "write", permissions: ["workspace.write"], claims: { projectId: "project-a" } },
  });
  const task = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId });
  await pair.open();
  const hello = await client.connect();
  return { client, connection, hello, task };
}

test("transport authentication overrides forged ClientHello identity and scope", async () => {
  let applicationAuthenticatorCalled = false;
  const core = createServerCore({
    serverId: "transport-auth-server",
    serverVersion: "test",
    capabilities: [],
    authenticate: () => {
      applicationAuthenticatorCalled = true;
      return { clientId: "forged-authority", authScope: "admin" };
    },
  });
  const value = await connected(core, "forged-client-hello");
  try {
    assert.equal(value.hello.clientId, "device-authority");
    assert.equal(value.hello.authScope, "write");
    assert.equal(value.connection.client.clientId, "device-authority");
    assert.deepEqual(value.connection.client.claims, { projectId: "project-a" });
    assert.deepEqual(value.connection.client.permissions, ["workspace.write"]);
    assert.equal(applicationAuthenticatorCalled, false);
  } finally {
    await value.client.close();
    await value.task;
  }
});

test("project claim covers panel objects, both panel-move projects, generic project update, and session-derived commands", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("claim-server"));
  const viewId = workspace.state.viewOrder[0];
  for (const command of [
    { type: "project.create", projectId: "project-a", viewId, root: "/a", name: "A" },
    { type: "project.create", projectId: "project-b", viewId, root: "/b", name: "B" },
    { type: "terminal.create", sessionId: "session-b", projectId: "project-b" },
    { type: "panel.create", panel: { id: "panel-b", projectId: "project-b", type: "terminal", sessionId: "session-b", createdAt: 1 } },
  ]) assert.equal(workspace.apply({ commandId: `seed-${workspace.state.revision}`, command }).ok, true);

  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "claim-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: ptyFactory(),
    workspace,
  });
  const value = await connected(composition.core, "forged-project-b-client");
  const revision = workspace.state.revision;
  try {
    const attempts = [
      { type: "panel.update", panelId: "panel-b", patch: { title: "stolen" } },
      { type: "panel.close", panelId: "panel-b" },
      { type: "panel.move", panelId: "panel-b", targetProjectId: "project-a" },
      { type: "project.update", projectId: "project-b", name: "B", root: "/b" },
      { type: "project.sidebar.update", projectId: "project-b", sidebar: { isFileExplorerOpen: true } },
      { type: "terminal.markInterrupted", sessionId: "session-b" },
      { type: "terminal.markExited", sessionId: "session-b", exitCode: 0 },
    ];
    for (const [index, command] of attempts.entries()) {
      await assert.rejects(
        value.client.command("workspace.command", { command }, { commandId: `forbidden-${index}` }),
        (error) => error?.code === "forbidden",
      );
      assert.equal(workspace.state.revision, revision);
    }

    await assert.rejects(
      value.client.command("workspace.command", {
        command: { type: "panel.move", panelId: "panel-b", targetProjectId: "project-b" },
      }, { commandId: "forbidden-source-project" }),
      (error) => error?.code === "forbidden",
    );
    assert.equal(workspace.state.revision, revision);
  } finally {
    await value.client.close();
    await value.task;
    await composition.shutdown();
  }
});
