import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminayClient,
  TerminayTerminalClient,
  TerminayTerminalPanelClient,
} from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  AUTOMATION_SPACE_PROJECT_ID,
  AUTOMATIONS_FEATURE_CAPABILITY,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

/**
 * A kept automation run terminal stays viewable after its process exits
 * (automations spec, "Keep terminal after run"). The server allows a bounded,
 * read-only attach to exactly such a terminal — exited, in the automation
 * space, with its panel still open — and to nothing else.
 */

const SERVER = "kept-server";
const SPACE = AUTOMATION_SPACE_PROJECT_ID;
const encoder = new TextEncoder();

function createPtyFactory() {
  const ptys = [];
  return {
    ptys,
    spawn() {
      const pty = {
        pid: 41_000 + ptys.length,
        dataListeners: new Set(),
        exitListeners: new Set(),
        write() {},
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

async function connect(composition, clientId, capabilities) {
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId, capabilities });
  await pair.open();
  await client.connect();
  return { client, serverTask };
}

function setup() {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "p", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" } }).ok, true);
  workspace.ensureAutomationSpace({ root: "/home/server" });
  const ptyFactory = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory,
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  return { workspace, composition, ptyFactory };
}

const identity = (projectId, sessionId) => ({ serverId: SERVER, projectId, sessionId });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const decode = (base64) => new TextDecoder().decode(Buffer.from(base64, "base64"));

test("an exited automation-space terminal with an open panel attaches read-only with its output and exit", async () => {
  const { workspace, composition, ptyFactory } = setup();
  const capable = await connect(composition, "capable", ["workspace.v1", AUTOMATIONS_FEATURE_CAPABILITY]);
  const legacy = await connect(composition, "legacy", ["workspace.v1"]);
  try {
    const created = await capable.client.command("terminal.create", { projectId: SPACE, cwd: "/home/server", cols: 80, rows: 24 }, { commandId: "kept" });
    const sessionId = created.result.sessionId;
    const pty = ptyFactory.ptys.at(-1);
    pty.emit("script output\r\n");
    await settle();

    // A running terminal keeps its ordinary attach rules.
    await assert.rejects(
      capable.client.command("terminal.attach", { identity: identity(SPACE, sessionId), clientId: "capable", fromPosition: 0, readOnly: true }, { commandId: "early" }),
      /only for an exited terminal/,
    );

    pty.exit(3);
    await settle();

    const attached = await capable.client.command("terminal.attach", { identity: identity(SPACE, sessionId), clientId: "capable", fromPosition: 0, readOnly: true }, { commandId: "view" });
    const result = attached.result;
    assert.equal(result.readOnly, true);
    const output = result.events.filter((event) => event.type === "output").map((event) => decode(event.bytes)).join("");
    assert.equal(output, "script output\r\n");
    const exit = result.events.find((event) => event.type === "exit");
    assert.equal(exit?.exitCode, 3);
    assert.equal(result.events.some((event) => event.type === "skip"), false);

    // A read-only view never controls the terminal.
    await assert.rejects(
      capable.client.command("terminal.input", { attachmentId: result.attachmentId, clientId: "capable", dataBase64: Buffer.from("x").toString("base64") }, { commandId: "type" }),
    );

    // The shared client decodes the same replay for an xterm.
    const panelClient = new TerminayTerminalPanelClient(new TerminayTerminalClient(capable.client));
    const view = await panelClient.attach({ ...identity(SPACE, sessionId), clientId: "capable", readOnly: true });
    const replay = view.initialEvents.filter((event) => event.type !== "dimensions");
    assert.deepEqual(replay.map((event) => event.type), ["output", "exit"]);
    assert.equal(new TextDecoder().decode(replay[0].bytes), "script output\r\n");
    await view.detach();

    // A connection that cannot see the automation space cannot view it.
    await assert.rejects(
      legacy.client.command("terminal.attach", { identity: identity(SPACE, sessionId), clientId: "legacy", fromPosition: 0, readOnly: true }, { commandId: "legacy-view" }),
      /not found/,
    );

    // Once a person closes the terminal it is no longer retained for viewing.
    const panelId = Object.values(workspace.state.panels).find((panel) => panel.sessionId === sessionId).id;
    assert.equal(workspace.apply({ commandId: "close", command: { type: "panel.close", panelId } }).ok, true);
    await assert.rejects(
      capable.client.command("terminal.attach", { identity: identity(SPACE, sessionId), clientId: "capable", fromPosition: 0, readOnly: true }, { commandId: "after-close" }),
      /has exited/,
    );
  } finally {
    await Promise.all([capable.client.close().catch(() => undefined), legacy.client.close().catch(() => undefined)]);
    await Promise.all([capable.serverTask.catch(() => undefined), legacy.serverTask.catch(() => undefined)]);
    await composition.shutdown();
  }
});

test("an exited terminal in an ordinary project is never attached read-only", async () => {
  const { composition, ptyFactory } = setup();
  const capable = await connect(composition, "capable", ["workspace.v1", AUTOMATIONS_FEATURE_CAPABILITY]);
  try {
    const created = await capable.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "user" });
    ptyFactory.ptys.at(-1).exit(0);
    await settle();
    await assert.rejects(
      capable.client.command("terminal.attach", { identity: identity("project-a", created.result.sessionId), clientId: "capable", fromPosition: 0, readOnly: true }, { commandId: "view" }),
      /has exited/,
    );
  } finally {
    await capable.client.close().catch(() => undefined);
    await capable.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

test("a read-only replay is bounded to the newest retained output and states what it left out", async () => {
  const { composition, ptyFactory } = setup();
  const capable = await connect(composition, "capable", ["workspace.v1", AUTOMATIONS_FEATURE_CAPABILITY]);
  try {
    const created = await capable.client.command("terminal.create", { projectId: SPACE, cwd: "/home/server", cols: 80, rows: 24 }, { commandId: "long" });
    const pty = ptyFactory.ptys.at(-1);
    const line = `${"x".repeat(1023)}\n`;
    for (let index = 0; index < 48; index += 1) pty.emit(line);
    pty.emit("THE END");
    pty.exit(0);
    await settle();
    const attached = await capable.client.command("terminal.attach", { identity: identity(SPACE, created.result.sessionId), clientId: "capable", fromPosition: 0, readOnly: true }, { commandId: "view" });
    const events = attached.result.events;
    const skip = events.find((event) => event.type === "skip");
    assert.equal(skip?.reason, "hydration");
    assert.equal(skip.fromPosition, 0);
    const replayed = events.filter((event) => event.type === "output").map((event) => decode(event.bytes)).join("");
    assert.ok(replayed.length <= 32 * 1024);
    assert.ok(replayed.endsWith("THE END"));
    assert.equal(skip.toPosition + Buffer.byteLength(replayed), 48 * 1024 + "THE END".length);
  } finally {
    await capable.client.close().catch(() => undefined);
    await capable.serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});
