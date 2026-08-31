import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createOperationDispatcher,
  createServerCore,
  createTerminalOperationRegistry,
  OrderedEventJournal,
  TerminalPresentationLeaseAuthority,
  TerminalService,
} from "../dist/index.js";

/**
 * Connection-scoped teardown.
 *
 * The production freeze this suite pins: a remote device reconnects, so two
 * ServerConnections briefly share one authenticated `clientId` (the stable
 * device id). When the superseded connection finally dies — up to 30 seconds
 * later, on its outbound backpressure deadline — its cleanup must release only
 * what that exact connection owned. Releasing by client id instead detached the
 * live replacement's attachments and leases, leaving the browser showing a
 * painted checkpoint that never streamed again.
 */

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

/** One authenticated request. `connectionId` is the transport generation;
 * `clientId` is the durable device identity shared across reconnects. */
function request(operation, payload, commandId, { connectionId, clientId = "device-x", authScope = "write" }) {
  return {
    envelope: { type: "command", commandId, correlationId: `${commandId}-correlation`, operation, payload },
    body: new Uint8Array(),
    context: { connectionId, clientId, authScope, signal: new AbortController().signal },
  };
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(sessionIds) {
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-scoped",
    ptyFactory: pty,
    generateSessionId: (() => {
      const queue = [...sessionIds];
      return () => queue.shift();
    })(),
  });
  const journal = new OrderedEventJournal();
  const presentations = new TerminalPresentationLeaseAuthority();
  const registry = createTerminalOperationRegistry({
    service,
    eventJournal: journal,
    presentations,
    allowUnresolvedTestSessions: true,
  });
  const dispatcher = createOperationDispatcher({
    serverId: "server-scoped",
    serverVersion: "test",
    capabilities: ["terminal"],
    ...registry.operations,
  });
  return { pty, service, journal, presentations, registry, dispatcher };
}

test("a superseded connection's teardown leaves the replacement connection streaming", async () => {
  const harness = createHarness(["session-live", "session-other"]);
  const { pty, service, journal, registry, dispatcher } = harness;
  const live = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const other = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const liveIdentity = { serverId: "server-scoped", projectId: "project-a", sessionId: live.snapshot().sessionId };
  const otherIdentity = { serverId: "server-scoped", projectId: "project-a", sessionId: other.snapshot().sessionId };

  // The superseded generation and its live replacement share one device id.
  const stale = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity: otherIdentity, fromPosition: 0 },
    "attach-stale",
    { connectionId: "connection-stale" },
  ));
  assert.equal(stale.ok, true);
  const replacement = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity: liveIdentity, fromPosition: 0 },
    "attach-replacement",
    { connectionId: "connection-live" },
  ));
  assert.equal(replacement.ok, true);
  const attachmentId = replacement.result.attachmentId;

  const streamed = [];
  const unsubscribe = journal.subscribe((event) => {
    if (event.event !== "terminal") return;
    if (event.payload.type !== "output" || event.payload.attachmentId !== attachmentId) return;
    streamed.push(new TextDecoder().decode(event.body));
  });

  // The stale generation dies long after the replacement hydrated.
  registry.closeConnection("connection-stale");

  pty.processes[0].emitData("live-after-stale-teardown");
  await nextTurn();

  assert.deepEqual(streamed, ["live-after-stale-teardown"],
    "the replacement connection must keep receiving live PTY output");
  assert.equal(service.getSession(liveIdentity).status, "running");
  unsubscribe();
});

test("a superseded connection's teardown keeps the replacement's presentation lease", async () => {
  const harness = createHarness(["session-lease", "session-lease-other"]);
  const { service, presentations, registry, dispatcher } = harness;
  const live = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const other = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const liveIdentity = { serverId: "server-scoped", projectId: "project-a", sessionId: live.snapshot().sessionId };
  const otherIdentity = { serverId: "server-scoped", projectId: "project-a", sessionId: other.snapshot().sessionId };

  await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity: otherIdentity, fromPosition: 0 },
    "attach-stale",
    { connectionId: "connection-stale" },
  ));
  const replacement = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity: liveIdentity, fromPosition: 0 },
    "attach-replacement",
    { connectionId: "connection-live" },
  ));
  const attachmentId = replacement.result.attachmentId;
  assert.equal(replacement.result.presentation.role, "controller");

  registry.closeConnection("connection-stale");

  const holder = presentations.state(liveIdentity).holder;
  assert.equal(holder?.attachmentId, attachmentId,
    "the replacement keeps control after the superseded generation is reaped");
  const resized = await dispatcher.command(request(
    "terminal.resize",
    { clientId: "device-x", identity: liveIdentity, attachmentId, cols: 120, rows: 40 },
    "resize-live",
    { connectionId: "connection-live" },
  ));
  assert.equal(resized.ok, true, "input authority survives the superseded generation's teardown");
});

test("an attachment taken over by another connection is told its stream ended", async () => {
  const harness = createHarness(["session-takeover"]);
  const { service, journal, dispatcher } = harness;
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const identity = { serverId: "server-scoped", projectId: "project-a", sessionId: session.snapshot().sessionId };

  const original = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity, fromPosition: 0 },
    "attach-original",
    { connectionId: "connection-original" },
  ));
  const originalAttachmentId = original.result.attachmentId;

  const notified = [];
  const unsubscribe = journal.subscribe((event) => {
    if (event.event !== "terminal" || event.payload.type !== "resync_required") return;
    notified.push(event.payload.attachmentId);
  });

  // A different live connection of the same device takes the session over.
  const takeover = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity, fromPosition: 0 },
    "attach-takeover",
    { connectionId: "connection-takeover" },
  ));
  assert.equal(takeover.ok, true);

  assert.deepEqual(notified, [originalAttachmentId],
    "the superseded attachment must not end silently while its connection is open");
  assert.equal(takeover.result.replacedAttachmentId, originalAttachmentId,
    "the replaced attachment is named so its delivery lane can be retired");
  unsubscribe();
});

test("a client's own detach does not raise a spurious recovery event", async () => {
  const harness = createHarness(["session-quiet-detach"]);
  const { service, journal, dispatcher } = harness;
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const identity = { serverId: "server-scoped", projectId: "project-a", sessionId: session.snapshot().sessionId };

  const attached = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity, fromPosition: 0 },
    "attach-quiet",
    { connectionId: "connection-quiet" },
  ));

  const notified = [];
  const unsubscribe = journal.subscribe((event) => {
    if (event.event === "terminal" && event.payload.type === "resync_required") notified.push(event.payload.attachmentId);
  });
  const detached = await dispatcher.command(request(
    "terminal.detach",
    { clientId: "device-x", identity, attachmentId: attached.result.attachmentId },
    "detach-quiet",
    { connectionId: "connection-quiet" },
  ));
  assert.equal(detached.ok, true);
  assert.deepEqual(notified, [], "a client-initiated detach is already known to that client");
  unsubscribe();
});

test("closing a connection releases exactly the attachments it created", async () => {
  const harness = createHarness(["session-own"]);
  const { service, registry, dispatcher } = harness;
  const session = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const identity = { serverId: "server-scoped", projectId: "project-a", sessionId: session.snapshot().sessionId };

  const owned = await dispatcher.command(request(
    "terminal.attach",
    { clientId: "device-x", identity, fromPosition: 0 },
    "attach-owned",
    { connectionId: "connection-owner" },
  ));
  const attachmentId = owned.result.attachmentId;

  registry.closeConnection("connection-owner");

  const reused = await dispatcher.command(request(
    "terminal.ack",
    { clientId: "device-x", identity, attachmentId, position: 0 },
    "ack-after-close",
    { connectionId: "connection-owner" },
  ));
  assert.equal(reused.ok, false, "the closing connection's own attachment is released");
  assert.equal(service.getSession(identity).status, "running", "the server-owned PTY is untouched");
});

async function connectHeartbeatClient(core, capabilities) {
  const pair = createInMemoryTransportPair();
  const connection = core.accept(pair.server);
  const task = connection.start().catch(() => undefined);
  const client = new TerminayClient({ transport: pair.client, clientId: "device-x", capabilities });
  await pair.open();
  await client.connect();
  return { client, connection, task };
}

test("the connection answers its own liveness probe", async () => {
  const core = createServerCore({
    serverId: "heartbeat-server",
    serverVersion: "test",
    capabilities: [],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  const session = await connectHeartbeatClient(core, ["connection.heartbeat"]);
  try {
    const sentAt = 1_234;
    const pong = await session.client.query("connection.ping", { sentAt });
    assert.equal(pong.ok, true);
    assert.equal(pong.result.sentAt, sentAt, "the probe is echoed so the client can measure round trip");
    assert.equal(typeof pong.result.serverTime, "number");
  } finally {
    await session.client.close().catch(() => undefined);
    await session.task;
  }
});

test("a heartbeat client that goes silent is reaped; a client that never promised one is not", async () => {
  const reaped = [];
  const core = createServerCore({
    serverId: "heartbeat-reaper",
    serverVersion: "test",
    capabilities: [],
    // A tight bound keeps the test deterministic; production uses 60s.
    heartbeatTimeoutMs: 60,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
    onConnectionClosed: (connectionId) => reaped.push(connectionId),
  });

  // A client that never advertised the heartbeat may idle indefinitely: Local
  // Desktop and MCP connections make no liveness promise.
  const quiet = await connectHeartbeatClient(core, []);
  // A client that promised to prove liveness and then went silent is a frozen
  // transport, even though nothing ever reported a close.
  const promised = await connectHeartbeatClient(core, ["connection.heartbeat"]);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(reaped, [promised.connection.connectionId],
    "only the connection that promised a heartbeat is reaped for silence");
  assert.equal(quiet.connection.state, "open");

  await quiet.client.close().catch(() => undefined);
  await promised.client.close().catch(() => undefined);
  await Promise.all([quiet.task, promised.task]);
});

test("a heartbeat keeps an idle connection alive indefinitely", async () => {
  const reaped = [];
  const core = createServerCore({
    serverId: "heartbeat-idle",
    serverVersion: "test",
    capabilities: [],
    heartbeatTimeoutMs: 120,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
    onConnectionClosed: (connectionId) => reaped.push(connectionId),
  });
  const session = await connectHeartbeatClient(core, ["connection.heartbeat"]);
  try {
    // No terminal output, no workspace events: a quiet workspace stays connected
    // on pings alone, which traffic inference could never distinguish from death.
    for (let beat = 0; beat < 6; beat += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const pong = await session.client.query("connection.ping", { sentAt: Date.now() });
      assert.equal(pong.ok, true);
    }
    assert.deepEqual(reaped, []);
    assert.equal(session.connection.state, "open");
  } finally {
    await session.client.close().catch(() => undefined);
    await session.task;
  }
});
