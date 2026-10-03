import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

/**
 * A terminal whose session ended while no server was attached keeps its panel,
 * and that panel shows the output the session ended with. A client reads it
 * through the same bounded, read-only attach a kept automation terminal uses.
 */

const SERVER = "ended-server";
const encoder = new TextEncoder();
const decode = (base64) => new TextDecoder().decode(Buffer.from(base64, "base64"));
const identity = (sessionId) => ({ serverId: SERVER, projectId: "project-a", sessionId });

function workspaceWith(sessions) {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  const apply = (commandId, command) => {
    const result = workspace.apply({ commandId, command });
    assert.equal(result.ok, true, result.ok ? undefined : result.conflict.message);
  };
  apply("p", { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" });
  for (const sessionId of sessions)
    apply(`t-${sessionId}`, {
      type: "terminal.createPanel", projectId: "project-a", sessionId, panelId: `panel-${sessionId}`, title: sessionId, cwd: "/repo/a", createdAt: 1,
    });
  // What loading a persisted workspace does to sessions that were running.
  workspace.markInterruptedSessions();
  return workspace;
}

/** A holder with nothing running and whatever tails a test gives it. */
function holderWithTails(tails) {
  return {
    spawn() { throw new Error("unexpected spawn"); },
    async start() { return []; },
    async adopt() { throw new Error("nothing is held"); },
    async end() {},
    async endAll() {},
    async detach() {},
    setLimit() {},
    readTail: (sessionId) => tails[sessionId],
    pruneTails() {},
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

function compose(workspace, holder) {
  return createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    sessionHolder: holder,
    workspace,
    workspaceStartup: { firstRun: false, createTerminal: async () => {} },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
}

const attachReadOnly = (client, sessionId, commandId) =>
  client.command("terminal.attach", { identity: identity(sessionId), clientId: "viewer", fromPosition: 0, readOnly: true }, { commandId });

test("an ended session with an open panel attaches read-only with its saved output and exit", async () => {
  const workspace = workspaceWith(["finished", "lost"]);
  const composition = compose(workspace, holderWithTails({
    finished: {
      sessionId: "finished", bufferedFrom: 100, outputPosition: 113, savedAt: 9, cols: 80, rows: 24,
      exit: { exitCode: 2, signal: null, at: 8 }, bytes: encoder.encode("build failed\n"),
    },
  }));
  await composition.start();
  const { client } = await connect(composition, "viewer");
  try {
    const attached = await attachReadOnly(client, "finished", "view-finished");
    assert.equal(attached.result.readOnly, true);
    const output = attached.result.events.filter((event) => event.type === "output").map((event) => decode(event.bytes)).join("");
    assert.equal(output, "build failed\n");
    assert.equal(attached.result.events.find((event) => event.type === "exit")?.exitCode, 2);

    // A session that left nothing behind still attaches: it has no output,
    // and the client is told it ended.
    const lost = await attachReadOnly(client, "lost", "view-lost");
    assert.deepEqual(lost.result.events.filter((event) => event.type === "output"), []);
    assert.equal(lost.result.events.some((event) => event.type === "exit"), true);

    // Input to either is refused: there is no process to receive it.
    await assert.rejects(
      client.command("terminal.input", { identity: identity("finished"), clientId: "viewer", bytes: Buffer.from("ls\n").toString("base64") }, { commandId: "type" }),
    );
  } finally {
    await client.close?.();
    await composition.shutdown();
  }
});

test("closing the panel ends what can be read", async () => {
  const workspace = workspaceWith(["finished"]);
  const composition = compose(workspace, holderWithTails({
    finished: { sessionId: "finished", bufferedFrom: 0, outputPosition: 3, savedAt: 9, bytes: encoder.encode("bye") },
  }));
  await composition.start();
  const { client } = await connect(composition, "viewer");
  try {
    await attachReadOnly(client, "finished", "before-close");
    const closed = composition.workspaceOperations.applyHostCommand("close", { type: "panel.close", panelId: "panel-finished" }, workspace.state.revision);
    assert.equal(closed.ok, true, closed.ok ? undefined : closed.conflict.message);
    await assert.rejects(attachReadOnly(client, "finished", "after-close"), /exited/);
  } finally {
    await client.close?.();
    await composition.shutdown();
  }
});

test("without a session holder an ended project terminal is still not readable", async () => {
  // The rule that only kept automation terminals are readable after exit is
  // unchanged for a server whose terminals do not outlive it.
  const workspace = workspaceWith([]);
  const ptys = [];
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory: {
      spawn() {
        const exits = new Set();
        const pty = {
          pid: 1, write() {}, resize() {}, kill() {},
          onData() { return () => {}; },
          onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
          exit(exitCode) { for (const listener of exits) listener({ exitCode, signal: null }); },
        };
        ptys.push(pty);
        return pty;
      },
    },
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const { client } = await connect(composition, "viewer");
  try {
    const created = await client.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "create" });
    ptys.at(-1).exit(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(attachReadOnly(client, created.result.sessionId, "view"), /exited/);
  } finally {
    await client.close?.();
    await composition.shutdown();
  }
});
