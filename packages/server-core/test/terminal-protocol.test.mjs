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
  const registry = createTerminalOperationRegistry({ service, eventJournal: journal, allowUnresolvedTestSessions: true });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: session.sessionId };

  const attached = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-1"));
  assert.equal(attached.ok, true);
  const attachment = attached.result;
  assert.equal(attachment.position, 0);
  assert.equal(attachment.presentation.role, "controller");

  pty.processes[0].emitData("hello");
  assert.equal(journal.revision, 2);
  const outputEvent = journal.replay(0).events.find((event) => event.payload.type === "output");
  assert.equal(outputEvent.payload.clientId, "client-a");

  const controlled = await dispatcher.command(request("terminal.presentation", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, mode: "acquire" }, "presentation-1"));
  assert.equal(controlled.ok, true, JSON.stringify(controlled));
  assert.equal(controlled.result.role, "controller");
  const input = await dispatcher.command(request("terminal.input", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, dataBase64: "aGk=" }, "input-1"));
  assert.equal(input.ok, true);
  assert.deepEqual([...pty.processes[0].writes[0]], [104, 105]);
  for (const source of ["macro", "dictation", "mcp"]) {
    const forged = await dispatcher.command(request("terminal.input", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, source, dataBase64: "eA==" }, `forged-${source}`));
    assert.equal(forged.ok, false);
    assert.equal(forged.error.details.reason, "source_boundary");
  }
  assert.equal(pty.processes[0].writes.length, 1, "server-authorized sources use their separate ordered adapter path");

  const resized = await dispatcher.command(request("terminal.resize", { clientId: "client-a", identity, attachmentId: attachment.attachmentId, cols: 100, rows: 30 }, "resize-1"));
  assert.equal(resized.ok, true);
  assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }]);

  const spoofed = await dispatcher.command(request("terminal.input", { clientId: "client-b", identity, attachmentId: attachment.attachmentId, dataBase64: "eA==" }, "spoof-1"));
  assert.equal(spoofed.ok, false);
  assert.equal(service.getSession(identity).status, "running");
  registry.closeClient("client-a");
  assert.equal(service.getSession(identity).status, "running");
});

test("terminal attach refuses an arbitrary replay suffix when the complete presentation exceeds the budget", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-replay-budget", ptyFactory: pty, generateSessionId: () => "session-replay-budget", maxReplayBytes: 128 });
  const session = await service.createSession({ projectId: "project-replay-budget", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
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
    assert.equal(attached.result.fromPosition, 6);
    assert.equal(attached.result.events.length, 1);
    assert.equal(attached.result.events[0].type, "presentation_unavailable");
    assert.equal(attached.result.events[0].requestedFromPosition, 0);
    assert.equal(attached.result.events[0].outputPosition, 6);
  } finally {
    await service.shutdown();
  }
});

test("only the explicit presentation holder can forward emulator replies", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-emulators", ptyFactory: pty, generateSessionId: () => "session-emulators" });
  const session = await service.createSession({ projectId: "project-emulators", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: service.serverId, projectId: "project-emulators", sessionId: session.sessionId };
  const attach = async (clientId) => (await dispatcher.command(request("terminal.attach", { clientId, identity, fromPosition: 0 }, `attach-${clientId}`, "write", clientId))).result;
  const desktop = await attach("desktop");
  const browser = await attach("browser");
  assert.equal(desktop.presentation.role, "controller");
  assert.equal(browser.presentation.role, "read_only");
  assert.equal(browser.presentation.holder.attachmentId, desktop.attachmentId);
  const replyFamilies = ["\u001b]10;rgb:dddd/eeee/ffff\u0007", "\u001b[?1;2c", "\u001b[0n", "\u001b[12;40R", "\u001b[4;768;1024t", "\u001b[I", "\u001b[<0;1;1M"];
  const send = (attachment, clientId, value, id) => dispatcher.command(request("terminal.input", { clientId, identity, attachmentId: attachment.attachmentId, dataBase64: Buffer.from(value).toString("base64") }, id, "write", clientId));

  await dispatcher.command(request("terminal.presentation", { clientId: "desktop", identity, attachmentId: desktop.attachmentId, mode: "acquire" }, "control-desktop", "write", "desktop"));
  for (const [index, reply] of replyFamilies.entries()) {
    assert.equal((await send(browser, "browser", reply, `browser-rejected-${index}`)).ok, false);
    assert.equal((await send(desktop, "desktop", reply, `desktop-accepted-${index}`)).ok, true);
  }
  assert.deepEqual(pty.processes[0].writes.map((bytes) => new TextDecoder().decode(bytes)), replyFamilies);

  await dispatcher.command(request("terminal.presentation", { clientId: "browser", identity, attachmentId: browser.attachmentId, mode: "takeover" }, "control-browser", "write", "browser"));
  assert.equal((await send(desktop, "desktop", "stale", "desktop-after-takeover")).ok, false);
  assert.equal((await send(browser, "browser", "first", "browser-first-after-takeover")).ok, true);
  assert.equal(new TextDecoder().decode(pty.processes[0].writes.at(-1)), "first");
  await service.shutdown();
});

test("fresh presentation replay preserves complete hostile control sequences at every emitted byte boundary", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-boundaries", ptyFactory: pty, generateSessionId: () => "session-boundaries", maxReplayBytes: 64 * 1024 });
  const session = await service.createSession({ projectId: "project-boundaries", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: service.serverId, projectId: "project-boundaries", sessionId: session.sessionId };
  const transcript = new TextEncoder().encode("utf8-é\u001b[31mred\u001b[0m\u001b]0;title\u0007\u001bP1;2|dcs\u001b\\\u001b[?1049halternate\u001b[?1049l\u001b[?2004h\u001b[1;2H\u001b[1;4;7mstyle\u001b[?2026hsync\u001b[?2026l");
  for (const byte of transcript) pty.processes[0].emitData(new Uint8Array([byte]));
  const attached = await dispatcher.command(request("terminal.attach", { clientId: "fresh", identity, fromPosition: 0, freshPresentation: true, maxInitialReplayBytes: 32 * 1024 }, "attach-boundaries", "write", "fresh"));
  assert.equal(attached.ok, true);
  assert.equal(attached.result.events.length, 1);
  assert.equal(attached.result.events[0].position, 0);
  assert.deepEqual(Buffer.from(attached.result.events[0].bytes, "base64"), Buffer.from(transcript));
  await service.shutdown();
});

test("framed terminal attach keeps an overstated fragmented replay inside the protocol header limit", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-protocol-budget",
    ptyFactory: pty,
    generateSessionId: () => "session-protocol-budget",
    maxReplayBytes: 128 * 1024,
  });
  const session = await service.createSession({ projectId: "project-protocol-budget", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({ service, eventJournal: journal, allowUnresolvedTestSessions: true });
  const pair = createInMemoryTransportPair();
  const server = createServerCore({
    serverId: "server-protocol-budget",
    serverVersion: "test",
    capabilities: ["terminal"],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    eventJournal: journal,
    ...registry.operations,
    onConnectionClosed: registry.closeClient,
  }).accept(pair.server);
  const serverTask = server.start();
  const protocolClient = new TerminayClient({ transport: pair.client, clientId: "client-a", capabilities: ["terminal"] });
  const facade = new TerminayClientFacade(protocolClient);
  const terminal = new TerminayTerminalClient({
    command: facade.command.bind(facade),
    subscribe: protocolClient.subscribe.bind(protocolClient),
  });

  for (let index = 0; index < 40_000; index += 1) pty.processes[0].emitData("x");

  try {
    await pair.open();
    await protocolClient.connect();
    const attached = await terminal.attach({
      serverId: "server-protocol-budget",
      projectId: "project-protocol-budget",
      sessionId: session.sessionId,
      clientId: "client-a",
      fromPosition: 0,
      maxInitialReplayBytes: 128 * 1024,
    });

    assert.equal(attached.initialEvents.length, 1);
    assert.equal(attached.initialEvents[0].type, "presentation_unavailable");
    assert.equal(attached.initialEvents[0].requestedFromPosition, 0);
    assert.equal(attached.position, 40_000);
  } finally {
    await protocolClient.close();
    await server.close();
    await serverTask;
    await service.shutdown();
  }
});

test("protocol client close releases its resize lease without terminating the server-owned PTY", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-resize-close", ptyFactory: pty, generateSessionId: () => "session-resize-close" });
  const session = await service.createSession({ projectId: "project-resize-close", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
  const dispatcher = createOperationDispatcher(registry.operations);
  const identity = { serverId: "server-resize-close", projectId: "project-resize-close", sessionId: session.sessionId };

  try {
    const firstAttachment = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-owner"));
    assert.equal(firstAttachment.ok, true);
    await dispatcher.command(request("terminal.presentation", { clientId: "client-a", identity, attachmentId: firstAttachment.result.attachmentId, mode: "acquire" }, "presentation-owner"));
    const firstResize = await dispatcher.command(request("terminal.resize", {
      clientId: "client-a", identity, attachmentId: firstAttachment.result.attachmentId, cols: 120, rows: 40,
    }, "resize-owner"));
    assert.equal(firstResize.ok, true);

    registry.closeClient("client-a");
    assert.equal(service.getSession(identity).status, "running");

    const secondAttachment = await dispatcher.command(request("terminal.attach", { clientId: "client-b", identity, fromPosition: 0 }, "attach-replacement", "write", "client-b"));
    assert.equal(secondAttachment.ok, true);
    await dispatcher.command(request("terminal.presentation", { clientId: "client-b", identity, attachmentId: secondAttachment.result.attachmentId, mode: "acquire" }, "presentation-replacement", "write", "client-b"));
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
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
  const dispatcher = createOperationDispatcher(registry.operations);
  const session = await service.createSession({ projectId: "project-resize-detach", cols: 80, rows: 24 });
  const identity = { serverId: "server-resize-detach", projectId: "project-resize-detach", sessionId: session.sessionId };

  try {
    const first = await dispatcher.command(request("terminal.attach", { clientId: "client-a", identity, fromPosition: 0 }, "attach-detach-owner"));
    assert.equal(first.ok, true);
    await dispatcher.command(request("terminal.presentation", { clientId: "client-a", identity, attachmentId: first.result.attachmentId, mode: "acquire" }, "presentation-detach-owner"));
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
    await dispatcher.command(request("terminal.presentation", { clientId: "client-b", identity, attachmentId: second.result.attachmentId, mode: "acquire" }, "presentation-detach-replacement", "write", "client-b"));
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
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
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
  const registry = createTerminalOperationRegistry({ service, eventJournal: journal, allowUnresolvedTestSessions: true });
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
    assert.equal(attachment.presentation.role, "controller");
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
