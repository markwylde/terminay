import assert from "node:assert/strict";
import test from "node:test";
import { MacroClient, TerminayClient, TerminayClientFacade } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { protocolError } from "@terminay/protocol";
import {
  createServerCoreComposition,
  HeadlessChannelTransport,
  MacroRepository,
  MacroRunner,
} from "../dist/index.js";

const target = Object.freeze({ serverId: "macro-server", projectId: "project-a", sessionId: "session-a" });

class FakeChannel {
  constructor(peer = null) {
    this.peer = peer;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.messages = new Set();
    this.states = new Set();
  }

  send(frame) {
    if (this.readyState !== "open") throw new Error("channel is not open");
    this.peer?.emit(new Uint8Array(frame));
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    for (const listener of [...this.states]) listener("closed");
    if (this.peer !== null && this.peer.readyState !== "closed") this.peer.close();
  }

  onMessage(listener) { this.messages.add(listener); return () => this.messages.delete(listener); }
  onStateChange(listener) { this.states.add(listener); return () => this.states.delete(listener); }
  emit(frame) { for (const listener of [...this.messages]) listener(frame); }
}

function createMemoryBackend() {
  let persisted;
  return {
    async load() { return persisted; },
    async commit(state) { persisted = state; },
  };
}

function createPtyFactory() {
  return {
    spawn() {
      return {
        pid: 50_000,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => undefined; },
        onExit() { return () => undefined; },
      };
    },
  };
}

function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("timed out waiting for macro condition"));
      setTimeout(check, 5);
    };
    check();
  });
}

async function createPair(kind) {
  if (kind === "local") {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    return { client: pair.client, server: pair.server, close: async () => { await pair.client.close(); await pair.server.close(); } };
  }
  const left = new FakeChannel();
  const right = new FakeChannel(left);
  left.peer = right;
  const client = new HeadlessChannelTransport(left);
  const server = new HeadlessChannelTransport(right);
  await Promise.all([client.open(), server.open()]);
  return { client, server, close: async () => { await client.close(); await server.close(); } };
}

for (const kind of ["local", "remote"]) {
  test(`macro editing and execution use the shared server path over ${kind} framed transport`, async () => {
    const writes = [];
    const waits = [];
    const repository = new MacroRepository(createMemoryBackend());
    const runner = new MacroRunner({ maxDelayMs: 10_000 });
    const composition = createServerCoreComposition({
      serverId: target.serverId,
      serverVersion: "test",
      capabilities: ["macros"],
      ptyFactory: createPtyFactory(),
      authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
      macros: {
        repository,
        runner,
        environmentFor(_request, exactTarget) {
          if (exactTarget.projectId !== target.projectId || exactTarget.sessionId !== target.sessionId) throw protocolError("forbidden", "macro target is not an authorized terminal");
          return {
            target: exactTarget,
            write(candidate, bytes) {
              assert.deepEqual(candidate, exactTarget);
              writes.push({ target: candidate, text: new TextDecoder().decode(bytes) });
            },
            key(candidate, key) {
              assert.deepEqual(candidate, exactTarget);
              writes.push({ target: candidate, text: `<key:${key}>` });
            },
            resolveSecret(candidate, secretId) {
              assert.deepEqual(candidate, exactTarget);
              assert.equal(secretId, "api-token");
              return new TextEncoder().encode("server-secret-value");
            },
            waitForInactivity(candidate, milliseconds) {
              assert.deepEqual(candidate, exactTarget);
              waits.push(milliseconds);
            },
          };
        },
      },
    });
    const session = await composition.terminal.createSession({ projectId: target.projectId, sessionId: target.sessionId, cols: 80, rows: 24 });
    const pair = await createPair(kind);
    const connection = composition.core.accept(pair.server);
    const serverTask = connection.start();
    const protocolClient = new TerminayClient({ transport: pair.client, clientId: `${kind}-client`, capabilities: ["macros"] });
    const macroClient = new MacroClient(new TerminayClientFacade(protocolClient));

    try {
      await protocolClient.connect();
      const initial = await macroClient.get();
      const saved = await macroClient.upsert({
        id: "deploy",
        title: "Deploy",
        steps: [
          { id: "type", type: "type", content: "deploy {{Environment}} " },
          { id: "secret", type: "secret", secretId: "api-token" },
          { id: "wait", type: "wait_inactivity", durationSeconds: "2" },
          { id: "enter", type: "key", key: "Enter" },
        ],
      }, { expectedRevision: initial.revision });
      assert.equal(saved.revision, 1);
      assert.equal(JSON.stringify(saved).includes("server-secret-value"), false);

      const run = await macroClient.run("deploy", target, { Environment: "prod" });
      await waitFor(() => runner.running === 0);
      assert.deepEqual(writes.map((entry) => entry.text), ["deploy prod ", "server-secret-value", "<key:Enter>"]);
      assert.deepEqual(waits, [2_000]);
      assert.equal(run.target.sessionId, session.sessionId);
      assert.equal(JSON.stringify(run).includes("server-secret-value"), false);

      await assert.rejects(() => macroClient.run("deploy", { ...target, sessionId: "other-session" }), (error) => error.code === "forbidden");

      const cancelState = await macroClient.upsert({ id: "cancel-me", steps: [{ id: "wait", type: "wait_time", durationSeconds: "5" }] }, { expectedRevision: saved.revision });
      const cancelRun = await macroClient.run("cancel-me", target);
      assert.equal(cancelRun.status, "running");
      await macroClient.cancel(cancelRun.runId, target);
      await waitFor(() => runner.running === 0);
      assert.equal(cancelState.revision, 2);
    } finally {
      await protocolClient.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
      await pair.close().catch(() => undefined);
      await composition.shutdown();
    }
  });
}

test("macro disconnect policy is applied by the server connection cleanup", async () => {
  const repository = new MacroRepository(createMemoryBackend());
  const runner = new MacroRunner({ maxDelayMs: 10_000 });
  const composition = createServerCoreComposition({
    serverId: target.serverId,
    serverVersion: "test",
    capabilities: ["macros"],
    ptyFactory: createPtyFactory(),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    macros: { repository, runner, environmentFor: (_request, exactTarget) => ({ target: exactTarget, write() {} }) },
  });
  const pair = createInMemoryTransportPair({ autoOpen: false });
  await pair.open();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId: "disconnect-client" });
  const macros = new MacroClient(new TerminayClientFacade(client));
  try {
    await client.connect();
    const saved = await macros.upsert({ id: "disconnect", steps: [{ id: "wait", type: "wait_time", durationSeconds: "5" }] });
    const run = await macros.run("disconnect", target);
    assert.equal(run.status, "running");
    await client.close();
    await waitFor(() => composition.eventJournal.replay().events.at(-1)?.payload.status === "canceled");
    assert.equal(runner.running, 0);
    assert.equal(composition.eventJournal.replay().events.at(-1).payload.status, "canceled");
    assert.equal(saved.revision, 1);
  } finally {
    await connection.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await pair.client.close().catch(() => undefined);
    await pair.server.close().catch(() => undefined);
    await composition.shutdown();
  }
});
