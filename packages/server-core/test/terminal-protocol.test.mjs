import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient, TerminayClientFacade, TerminayTerminalClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createOperationDispatcher,
  createTerminalOperationRegistry,
  OrderedEventJournal,
  createServerCore,
  ServerRuntime,
  TerminalService,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 9000 + processes.length,
        options,
        writes: [],
        resizes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; for (const listener of dataListeners) listener(bytes); },
        emitExit(value = {}) { for (const listener of exitListeners) listener(value); },
      };
      processes.push(process);
      return process;
    },
  };
}

function request(operation, payload, commandId, authScope = "write", clientId = "client-a") {
  return {
    envelope: { type: "command", commandId, correlationId: `${commandId}-correlation`, operation, payload },
    body: new Uint8Array(),
    context: { connectionId: `connection-${clientId}`, clientId, authScope, signal: new AbortController().signal },
  };
}

test("terminal operation registry binds the client contract to one server-owned session", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, generateSessionId: () => "session-a" });
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({ service, eventJournal: journal });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: session.sessionId };

  const attached = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-1"));
  assert.equal(attached.ok, true);
  const attachment = attached.result;
  assert.equal(attachment.position, 0);

  pty.processes[0].emitData("hello");
  assert.equal(journal.revision, 1);
  assert.equal(journal.replay(0).events[0].payload.clientId, "client-a");

  const input = await dispatcher.command(request("terminal.input", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, dataBase64: "aGk=" }, "input-1"));
  assert.equal(input.ok, true);
  assert.deepEqual([...pty.processes[0].writes[0]], [104, 105]);

  const resized = await dispatcher.command(request("terminal.resize", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, cols: 100, rows: 30 }, "resize-1"));
  assert.equal(resized.ok, true);
  assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }]);

  const spoofed = await dispatcher.command(request("terminal.input", { clientId: "client-b", identity, attachmentId: attachment.attachmentId, dataBase64: "eA==" }, "spoof-1"));
  assert.equal(spoofed.ok, false);
  assert.equal(service.getSession(identity).status, "running");
  registry.closeClient("client-a");
  assert.equal(service.getSession(identity).status, "running");
});

test("terminal attach clamps initial replay to the requested byte budget", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-replay-budget", ptyFactory: pty, generateSessionId: () => "session-replay-budget", maxReplayBytes: 128 });
  const session = await service.createSession({ projectId: "project-replay-budget", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: "server-replay-budget", projectId: "project-replay-budget", sessionId: session.sessionId };

  pty.processes[0].emitData("abcdef");

  try {
    const attached = await dispatcher.command(request("terminal.attach", {
      clientId: "client-a",
      identity,
      fromPosition: 0,
      maxInitialReplayBytes: 4,
    }, "attach-replay-budget"));

    assert.equal(attached.ok, true);
    assert.equal(attached.result.fromPosition, 2);
    assert.equal(attached.result.events.length, 1);
    assert.equal(attached.result.events[0].position, 2);
    assert.equal(attached.result.events[0].nextPosition, 6);
    assert.equal(Buffer.from(attached.result.events[0].bytes, "base64").toString("utf8"), "cdef");
  } finally {
    await service.shutdown();
  }
});

test("protocol client close releases its resize lease without terminating the server-owned PTY", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-resize-close", ptyFactory: pty, generateSessionId: () => "session-resize-close" });
  const session = await service.createSession({ projectId: "project-resize-close", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: "server-resize-close", projectId: "project-resize-close", sessionId: session.sessionId };

  try {
    const firstAttachment = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-owner"));
    assert.equal(firstAttachment.ok, true);
    const firstResize = await dispatcher.command(request("terminal.resize", {
      clientId: "client-a", identity, attachmentId: firstAttachment.result.attachmentId, cols: 120, rows: 40,
    }, "resize-owner"));
    assert.equal(firstResize.ok, true);

    registry.closeClient("client-a");
    assert.equal(service.getSession(identity).status, "running");

    const secondAttachment = await dispatcher.command(request("terminal.attach", { clientId: "client-b", identity, fromPosition: 0 }, "attach-replacement", "write", "client-b"));
    assert.equal(secondAttachment.ok, true);
    const secondResize = await dispatcher.command(request("terminal.resize", {
      clientId: "client-b", identity, attachmentId: secondAttachment.result.attachmentId, cols: 40, rows: 16, viewport: "mobile",
    }, "resize-replacement", "write", "client-b"));
    assert.equal(secondResize.ok, true, "the replacement client must not wait for the disconnected client's lease");
    assert.deepEqual(pty.processes[0].resizes, [{ cols: 120, rows: 40 }, { cols: 40, rows: 16 }]);
  } finally {
    await service.shutdown();
  }
});

test("terminal detach releases its resize lease for the next authenticated client", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-resize-detach", ptyFactory: pty, generateSessionId: () => "session-resize-detach" });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  const dispatcher = createOperationDispatcher(registry.operations);
  const session = await service.createSession({ projectId: "project-resize-detach", cols: 80, rows: 24 });
  const identity = { serverId: "server-resize-detach", projectId: "project-resize-detach", sessionId: session.sessionId };

  try {
    const first = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-detach-owner"));
    assert.equal(first.ok, true);
    const resize = await dispatcher.command(request("terminal.resize", {
      clientId: "client-a", identity, attachmentId: first.result.attachmentId, cols: 120, rows: 40,
    }, "resize-detach-owner"));
    assert.equal(resize.ok, true);
    const detached = await dispatcher.command(request("terminal.detach", {
      clientId: "client-a", identity, attachmentId: first.result.attachmentId,
    }, "detach-owner", "read"));
    assert.equal(detached.ok, true);

    const second = await dispatcher.command(request("terminal.attach", { clientId: "client-b", identity, fromPosition: 0 }, "attach-detach-replacement", "write", "client-b"));
    assert.equal(second.ok, true);
    const replacementResize = await dispatcher.command(request("terminal.resize", {
      clientId: "client-b", identity, attachmentId: second.result.attachmentId, cols: 40, rows: 16,
    }, "resize-detach-replacement", "write", "client-b"));
    assert.equal(replacementResize.ok, true, "a detached client must not retain the terminal viewport");
    assert.equal(service.getSession(identity).status, "running");
  } finally {
    await service.shutdown();
  }
});

test("terminal creation is a write-scoped server operation with a server-owned session id", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-create", ptyFactory: pty, generateSessionId: () => "session-created" });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  const dispatcher = createOperationDispatcher(registry.operations);

  const created = await dispatcher.command(request("terminal.create", { projectId: "project-create", cwd: "/workspace", cols: 120, rows: 40 }, "create-1"));
  assert.equal(created.ok, true);
  assert.deepEqual(created.result.dimensions, { cols: 120, rows: 40 });
  assert.equal(created.result.sessionId, "session-created");
  assert.equal(created.result.cwd, "/workspace");
  assert.equal(pty.processes[0].options.cwd, "/workspace");

  const forbidden = await dispatcher.command(request("terminal.create", { projectId: "project-create" }, "create-read", "read"));
  assert.equal(forbidden.ok, false);
  await service.shutdown();
});

test("framed ServerConnection exposes server-owned terminal operations through the canonical dispatcher", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-framed", ptyFactory: pty, generateSessionId: () => "session-framed" });
  const session = await service.createSession({ projectId: "project-framed", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({ service, eventJournal: journal });
  const pair = createInMemoryTransportPair();
  const server = createServerCore({
    serverId: "server-framed",
    serverVersion: "test",
    capabilities: ["terminal"],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    eventJournal: journal,
    ...registry.operations,
    onConnectionClosed: registry.closeClient,
  }).accept(pair.server);
  const serverTask = server.start();
  const protocolClient = new TerminayClient({ transport: pair.client, clientId: "client-framed", capabilities: ["terminal"] });
  const clientFacade = new TerminayClientFacade(protocolClient);
  const terminalClient = new TerminayTerminalClient({
    command: clientFacade.command.bind(clientFacade),
    subscribe: protocolClient.subscribe.bind(protocolClient),
  });
  const identity = { serverId: "server-framed", projectId: "project-framed", sessionId: session.sessionId };

  try {
    await pair.open();
    await protocolClient.connect();
    const attachment = await terminalClient.attach({ ...identity, clientId: "client-framed" });
    const output = new Promise((resolve) => {
      attachment.onEvent((event) => {
        if (event.type === "output") resolve(event);
      });
    });

    pty.processes[0].emitData("server-owned\n");
    assert.deepEqual([...((await output).bytes)], [...new TextEncoder().encode("server-owned\n")]);

    await attachment.write("echo framed");
    await attachment.resize({ cols: 100, rows: 30 });
    assert.deepEqual([...pty.processes[0].writes[0]], [...new TextEncoder().encode("echo framed")]);
    assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }]);

    const listed = await protocolClient.query("terminal.list", { projectId: identity.projectId });
    assert.equal(listed.result.sessions[0].sessionId, identity.sessionId);
    assert.equal(listed.result.sessions[0].projectId, identity.projectId);
    const inactive = await protocolClient.query("terminal.wait-inactivity", {
      projectId: identity.projectId, sessionId: identity.sessionId, durationMs: 0,
    });
    assert.deepEqual(inactive.result, { ...identity, inactive: true });
    await attachment.detach();
    assert.equal(service.getSession(identity).status, "running");
  } finally {
    await protocolClient.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await service.shutdown().catch(() => undefined);
  }
});

test("runtime shutdown owns the terminal service without exposing terminal content in diagnostics", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-runtime", ptyFactory: pty, generateSessionId: () => "runtime-session" });
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const runtime = new ServerRuntime({
    serverId: "server-runtime",
    serverVersion: "1.0.0",
    dataRoot: "/tmp/terminay-task8",
    runtimeMode: "standalone",
    services: { terminal: service },
  });
  assert.deepEqual(runtime.diagnostics().terminal, { sessions: 1, runningSessions: 1 });
  await runtime.start();
  await runtime.stop();
  assert.equal(session.status, "interrupted");
  assert.equal(runtime.diagnostics().terminal.runningSessions, 0);
  assert.equal(JSON.stringify(runtime.diagnostics()).includes("hello"), false);
});
