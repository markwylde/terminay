import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { MessageChannel } from "node:worker_threads";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import {
  TerminalService,
  createServerCoreComposition,
} from "../dist/index.js";

class AsyncByteQueue {
  #values = [];
  #waiters = [];
  #ended = false;

  push(value) {
    if (this.#ended) return;
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#values.push(value);
    else waiter({ value, done: false });
  }

  end() {
    if (this.#ended) return;
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.#values.length > 0) {
        yield this.#values.shift();
        continue;
      }
      if (this.#ended) return;
      const next = await new Promise((resolve) => this.#waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

/**
 * The only transport-specific code in this test. It deliberately models the
 * browser/Electron MessagePort surface (`postMessage`, `onmessage`, `start`,
 * and `close`) and adapts it to the transport-neutral ByteTransport contract.
 */
class MessagePortByteTransport {
  #port;
  #state = "closed";
  #incoming = new AsyncByteQueue();
  #listeners = new Set();

  constructor(port) {
    this.#port = port;
    this.#port.onmessage = (event) => {
      const value = event?.data;
      if (value instanceof Uint8Array) this.#incoming.push(new Uint8Array(value));
      else if (value instanceof ArrayBuffer) this.#incoming.push(new Uint8Array(value));
      else throw new TypeError("message port frames must be byte arrays");
    };
  }

  get state() { return this.#state; }
  get incoming() { return this.#incoming; }
  get queuedBytes() { return 0; }
  get bufferedBytes() { return 0; }

  async open() {
    if (this.#state === "open") return;
    if (this.#state !== "closed") throw new Error(`transport is ${this.#state}`);
    this.#setState("opening");
    this.#port.start();
    this.#setState("open");
  }

  async send(frame) {
    if (this.#state !== "open") throw new Error("transport is not open");
    if (!(frame instanceof Uint8Array) || frame.byteLength === 0) throw new TypeError("invalid transport frame");
    this.#port.postMessage(new Uint8Array(frame));
  }

  async waitForWritable() {}

  async close(reason = { code: "normal" }) {
    if (this.#state === "closed") return;
    this.#setState("closing", reason);
    this.#incoming.end();
    this.#port.onmessage = null;
    this.#port.close();
    this.#setState("closed", reason);
  }

  onStateChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setState(state, reason) {
    this.#state = state;
    for (const listener of this.#listeners) listener(state, reason);
  }
}

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 12_000 + processes.length,
        options,
        writes: [],
        resizes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(value = {}) { for (const listener of exitListeners) listener(value); },
      };
      processes.push(process);
      return process;
    },
  };
}

function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("timed out waiting for condition"));
      setTimeout(check, 5);
    };
    check();
  });
}

function getOperation(collection, name) {
  if (collection !== undefined && typeof collection.get === "function") return collection.get(name);
  return collection?.[name];
}

async function closeQuietly(client, server, serverTask, transports) {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await serverTask?.catch(() => undefined);
  await Promise.all(transports.map((transport) => transport.close().catch(() => undefined)));
}

test("server-core composition dispatches terminal operations through a MessagePort-shaped boundary", async () => {
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "embedded-server",
    serverVersion: "test",
    capabilities: ["terminal"],
    ptyFactory: pty,
    terminalOptions: { generateSessionId: () => "session-a" },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    operations: {
      queries: {
        "composition.ping": () => ({ composed: true }),
      },
      policies: {
        "composition.ping": { scope: "read" },
      },
    },
  });
  const session = await composition.terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const { terminal, terminalOperations, operations, eventJournal } = composition;

  assert.ok(terminal instanceof TerminalService);
  assert.equal(typeof terminalOperations.closeConnection, "function");
  assert.ok(getOperation(terminalOperations.operations.commands, "terminal.attach"));
  assert.ok(getOperation(terminalOperations.operations.queries, "terminal.list"));
  for (const operation of [
    "terminal.attach",
    "terminal.resume",
    "terminal.ack",
    "terminal.input",
    "terminal.resize",
    "terminal.kill",
    "terminal.detach",
  ]) assert.ok(getOperation(operations.commands, operation), operation);
  assert.ok(getOperation(operations.queries, "terminal.list"));
  assert.ok(getOperation(operations.queries, "composition.ping"));
  assert.ok(getOperation(operations.policies, "composition.ping"));
  for (const operation of [
    "terminal.list",
    "terminal.attach",
    "terminal.resume",
    "terminal.ack",
    "terminal.input",
    "terminal.resize",
    "terminal.kill",
    "terminal.detach",
  ]) assert.ok(getOperation(operations.policies, operation), operation);
  assert.equal(composition.coreOptions.eventJournal, eventJournal);
  assert.ok(getOperation(composition.coreOptions.commands, "terminal.attach"));
  assert.ok(getOperation(composition.coreOptions.queries, "terminal.list"));
  assert.ok(getOperation(composition.coreOptions.policies, "terminal.list"));

  const { port1, port2 } = new MessageChannel();
  const serverTransport = new MessagePortByteTransport(port1);
  const clientTransport = new MessagePortByteTransport(port2);
  const server = composition.core.accept(serverTransport);
  const serverTask = server.start();
  const client = new TerminayClient({
    transport: clientTransport,
    clientId: "desktop-client",
    capabilities: ["terminal"],
  });
  const identity = {
    serverId: "embedded-server",
    projectId: "project-a",
    sessionId: session.sessionId,
  };

  try {
    await client.connect();
    const ping = await client.query("composition.ping");
    assert.deepEqual(ping.result, { composed: true });

    const attached = await client.command("terminal.attach", {
      clientId: "desktop-client",
      identity,
      fromPosition: 0,
    });
    assert.equal(attached.ok, true);
    assert.equal(attached.result.position, 0);

    const controlled = await client.command("terminal.presentation", {
      clientId: "desktop-client",
      identity,
      attachmentId: attached.result.attachmentId,
      mode: "acquire",
    });
    assert.equal(controlled.result.role, "controller");

    const input = await client.command("terminal.input", {
      clientId: "desktop-client",
      identity,
      attachmentId: attached.result.attachmentId,
      dataBase64: "aGk=",
    });
    assert.equal(input.ok, true);
    assert.deepEqual([...pty.processes[0].writes[0]], [104, 105]);

    const resized = await client.command("terminal.resize", {
      clientId: "desktop-client",
      identity,
      attachmentId: attached.result.attachmentId,
      cols: 100,
      rows: 30,
    });
    assert.equal(resized.ok, true);
    assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }]);

    pty.processes[0].emitData("server-owned");
    await waitFor(() => eventJournal.revision >= 2);
    assert.equal(eventJournal.replay(0).events.at(-1).event, "terminal");

    const listed = await client.query("terminal.list", { projectId: "project-a" });
    assert.equal(listed.ok, true);
    assert.equal(listed.result.sessions[0].sessionId, session.sessionId);
    assert.equal(terminal.getSession(identity).status, "running");
  } finally {
    await closeQuietly(client, server, serverTask, [serverTransport, clientTransport]);
    await composition.shutdown();
  }
});

test("composition shutdown closes active transport connections before the PTY authority", async () => {
  const pty = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "shutdown-server",
    serverVersion: "test",
    capabilities: [],
    ptyFactory: pty,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  const session = await composition.terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const { port1, port2 } = new MessageChannel();
  const serverTransport = new MessagePortByteTransport(port1);
  const clientTransport = new MessagePortByteTransport(port2);
  const server = composition.core.accept(serverTransport);
  const serverTask = server.start();
  const client = new TerminayClient({ transport: clientTransport, clientId: "shutdown-client" });
  try {
    await client.connect();
    await composition.shutdown();
    assert.equal(server.state, "closed");
    assert.equal(composition.terminal.getSession({ serverId: "shutdown-server", projectId: "project-a", sessionId: session.sessionId }).status, "interrupted");
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await Promise.all([serverTransport.close().catch(() => undefined), clientTransport.close().catch(() => undefined)]);
  }
});

test("server-core source and emitted module graph contain no Electron import", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const sourceRoot = resolve(testDirectory, "../src");
  const distRoot = resolve(testDirectory, "../dist");
  const roots = [sourceRoot, distRoot];
  const moduleSpecifier = /(?:from\s*|import\s*\(|require\s*\()(['"])(?:electron|electron\/)[^'"]*\1/u;
  const offenders = [];

  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (/\.(?:ts|mjs|js)$/u.test(entry.name)) {
        const content = await readFile(path, "utf8");
        if (moduleSpecifier.test(content)) offenders.push(path);
      }
    }
  }

  for (const root of roots) await inspect(root);
  assert.deepEqual(offenders, []);
});
