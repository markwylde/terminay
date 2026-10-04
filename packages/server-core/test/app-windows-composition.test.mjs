import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import {
  APP_WINDOW_EVENTS,
  APP_WINDOW_OPERATIONS,
  ServerSettingsRepository,
  createServerCoreComposition,
} from "../dist/index.js";

const SERVER = "windows-server";
const identity = { serverId: SERVER, projectId: "project-a", sessionId: "session-a" };

function recordingPty() {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        pid: 4000 + processes.length,
        writes: [],
        write(bytes) { process.writes.push(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
        emitData(value) { for (const listener of data) listener(new TextEncoder().encode(value)); },
        emitExit() { for (const listener of exits) listener({ exitCode: 0, signal: null }); },
      };
      processes.push(process);
      return process;
    },
  };
}

async function composed({ permissions = {}, appWindows = {} } = {}) {
  let persisted;
  const settings = new ServerSettingsRepository({
    load: async () => structuredClone(persisted),
    commit: async (state) => { persisted = structuredClone(state); },
  });
  const pty = recordingPty();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: [],
    ptyFactory: pty,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: hello.clientId === "reader" ? "read" : "write" }),
    settings,
    mcpApprovals: true,
    ...(appWindows === null ? {} : { appWindows }),
  });
  const cleanups = [];
  const connect = async (clientId, { attach = true } = {}) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.appWindows] });
    const hello = await client.connect();
    cleanups.push(async () => {
      await client.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await task.catch(() => undefined);
    });
    if (attach) await client.command("terminal.attach", { clientId, identity, fromPosition: 0 });
    return { client, hello };
  };
  await composition.start();
  await settings.update({ terminayMcp: { enabled: true, permissions } });
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  return {
    composition,
    pty,
    connect,
    process: () => pty.processes[0],
    close: async () => { for (const cleanup of cleanups) await cleanup(); await composition.shutdown(); },
  };
}

const open = (server, overrides = {}) =>
  server.composition.appWindows.open({
    terminalSessionId: identity.sessionId,
    projectId: identity.projectId,
    title: "Deploy configurator",
    source: { kind: "agent" },
    html: "<button>Deploy</button>",
    ...overrides,
  });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });
}

test("the server advertises app windows only when they are composed", async () => {
  const withWindows = await composed();
  try {
    assert.ok((await withWindows.connect("desktop", { attach: false })).hello.capabilities.includes("app-windows.v1"));
  } finally {
    await withWindows.close();
  }
  const without = await composed({ appWindows: null });
  try {
    const { client, hello } = await without.connect("desktop", { attach: false });
    assert.equal(hello.capabilities.includes("app-windows.v1"), false);
    assert.equal(without.composition.appWindows, undefined);
    await assert.rejects(client.query(APP_WINDOW_OPERATIONS.list, {}));
  } finally {
    await without.close();
  }
});

test("a window message from the controlling client is typed into the owning terminal and submitted once", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    await client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "Deploy api to eu-west-1" });
    assert.deepEqual(server.process().writes, ["Deploy api to eu-west-1\r"]);
    assert.equal(server.composition.appWindows.list(identity.sessionId)[0].state, "minimised");
  } finally {
    await server.close();
  }
});

test("a window message uses bracketed paste when the terminal has enabled it", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    server.process().emitData("\u001b[?2004h$ ");
    await client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "line one\nline two" });
    assert.deepEqual(server.process().writes, ["\u001b[200~line one\nline two\u001b[201~\r"]);
  } finally {
    await server.close();
  }
});

test("a client that does not control the terminal cannot speak for its windows", async () => {
  const server = await composed();
  try {
    await server.connect("desktop");
    const phone = await server.connect("phone");
    const window = open(server);
    await rejectsWith(phone.client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "hi" }), "forbidden");
    await rejectsWith(phone.client.command(APP_WINDOW_OPERATIONS.context, { windowId: window.id, text: "hi" }), "forbidden");
    assert.deepEqual(server.process().writes, []);
    assert.equal(server.composition.appWindows.list(identity.sessionId)[0].state, "open");
    // It can still see that the window exists.
    const listed = await phone.client.query(APP_WINDOW_OPERATIONS.list, {});
    assert.deepEqual(listed.result.windows.map((entry) => entry.title), ["Deploy configurator"]);
  } finally {
    await server.close();
  }
});

test("with no client attached nobody holds control, so a message is refused", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop", { attach: false });
    const window = open(server);
    await rejectsWith(client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "hi" }), "forbidden");
    assert.deepEqual(server.process().writes, []);
  } finally {
    await server.close();
  }
});

test("Never Allow for Window Messages refuses the view and writes nothing", async () => {
  const server = await composed({ permissions: { windowMessages: "deny" } });
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    await rejectsWith(client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "hi" }), "forbidden");
    assert.deepEqual(server.process().writes, []);
    assert.equal(server.composition.appWindows.list(identity.sessionId)[0].state, "open");
  } finally {
    await server.close();
  }
});

test("Ask Permission for Window Messages prompts with the window and the full text, and types only once allowed", async () => {
  const server = await composed({
    permissions: { windowMessages: "ask" },
    appWindows: { terminalTitle: (sessionId) => (sessionId === identity.sessionId ? "Terminal 1" : undefined) },
  });
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    const sending = client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "Deploy api to eu-west-1" });
    const approvals = server.composition.mcpApprovals;
    for (let attempt = 0; attempt < 50 && approvals.list().length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    const [approval] = approvals.list();
    assert.equal(approval.group, "windowMessages");
    assert.equal(approval.groupLabel, "Window Messages");
    assert.equal(approval.terminalSessionId, identity.sessionId);
    assert.equal(approval.terminalTitle, "Terminal 1");
    assert.match(approval.agent, /Deploy configurator/);
    assert.deepEqual(approval.details, [{ label: "Message", value: "Deploy api to eu-west-1", code: true }]);
    assert.deepEqual(server.process().writes, []);
    approvals.decide(approval.id, "once");
    await sending;
    assert.deepEqual(server.process().writes, ["Deploy api to eu-west-1\r"]);
  } finally {
    await server.close();
  }
});

test("a reader may list windows but not fetch a document or change one", async () => {
  const server = await composed();
  try {
    const reader = await server.connect("reader", { attach: false });
    const window = open(server);
    assert.equal((await reader.client.query(APP_WINDOW_OPERATIONS.list, {})).result.windows.length, 1);
    await assert.rejects(reader.client.query(APP_WINDOW_OPERATIONS.content, { windowId: window.id }));
    await assert.rejects(reader.client.command(APP_WINDOW_OPERATIONS.close, { windowId: window.id }));
    assert.equal(server.composition.appWindows.list().length, 1);
  } finally {
    await server.close();
  }
});

test("clients are told a window changed without being sent its title or document", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const seen = [];
    const subscription = await client.subscribe(APP_WINDOW_EVENTS.changed);
    subscription.onEvent((event) => seen.push(event.payload));
    const window = open(server, { title: "Secret plans", html: "<p>secret</p>" });
    for (let attempt = 0; attempt < 50 && seen.length === 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    await subscription.unsubscribe().catch(() => undefined);
    assert.equal(seen.at(-1).windows[0].id, window.id);
    assert.equal(JSON.stringify(seen).includes("Secret"), false);
    assert.equal(JSON.stringify(seen).includes("secret"), false);
  } finally {
    await server.close();
  }
});

test("when another device takes control, it speaks for the terminal's windows and the former holder no longer can", async () => {
  const server = await composed();
  try {
    const desktop = await server.connect("desktop", { attach: false });
    await desktop.client.command("terminal.attach", { clientId: "desktop", identity, fromPosition: 0 });
    const phone = await server.connect("phone", { attach: false });
    const attachedPhone = await phone.client.command("terminal.attach", { clientId: "phone", identity, fromPosition: 0 });
    const window = open(server);
    await desktop.client.command(APP_WINDOW_OPERATIONS.context, { windowId: window.id, text: "from desktop" });
    await rejectsWith(phone.client.command(APP_WINDOW_OPERATIONS.context, { windowId: window.id, text: "from phone" }), "forbidden");

    await phone.client.command("terminal.presentation", { clientId: "phone", identity, attachmentId: attachedPhone.result.attachmentId, mode: "takeover" });

    await rejectsWith(desktop.client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "stale" }), "forbidden");
    await phone.client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "from the phone" });
    assert.deepEqual(server.process().writes, ["from the phone\r"]);
    // The window did not change: the new holder rebuilds the view from the
    // same server record.
    const listed = await phone.client.query(APP_WINDOW_OPERATIONS.list, {});
    assert.deepEqual(listed.result.windows.map((entry) => entry.id), [window.id]);
  } finally {
    await server.close();
  }
});

test("a terminal's windows end when its process exits", async () => {
  const server = await composed();
  try {
    await server.connect("desktop");
    open(server);
    assert.equal(server.composition.appWindows.list().length, 1);
    server.process().emitExit();
    for (let attempt = 0; attempt < 50 && server.composition.appWindows.list().length > 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(server.composition.appWindows.list().length, 0);
  } finally {
    await server.close();
  }
});
