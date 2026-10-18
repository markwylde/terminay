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
    if (event.event !== "terminal" || event.payload.type !== "skip") return;
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
    if (event.event === "terminal" && event.payload.type === "skip") notified.push(event.payload.attachmentId);
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

/**
 * A clock for the silence deadline that moves only when the test moves it.
 * `advance` is time passing with the server awake: every deadline that comes
 * due fires, in order. `sleep` is a machine waking from sleep: the wall clock
 * jumps, and only then does each overdue deadline fire, late.
 */
function createManualClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const fireDue = () => {
    for (;;) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= now)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (due === undefined) return;
      timers.delete(due.id);
      due.handler();
    }
  };
  return {
    now: () => now,
    timers: {
      setTimeout(handler, ms) {
        nextId += 1;
        const timer = { id: nextId, at: now + ms, handler };
        timers.set(timer.id, timer);
        return timer;
      },
      clearTimeout(timer) {
        timers.delete(timer.id);
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.values()]
          .filter((timer) => timer.at <= target)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0];
        if (next === undefined) break;
        now = next.at;
        fireDue();
      }
      now = target;
    },
    sleep(ms) {
      now += ms;
      fireDue();
    },
  };
}

/** Let whatever a fired deadline started finish: closing is asynchronous. */
async function settled(connection) {
  for (let turn = 0; turn < 20 && connection.state === "open"; turn += 1) await nextTurn();
  for (let turn = 0; turn < 20; turn += 1) await nextTurn();
}

function heartbeatCore(serverId, heartbeatTimeoutMs, clock, reaped) {
  return createServerCore({
    serverId,
    serverVersion: "test",
    capabilities: [],
    heartbeatTimeoutMs,
    heartbeatNow: clock.now,
    heartbeatTimers: clock.timers,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
    onConnectionClosed: (connectionId) => reaped.push(connectionId),
  });
}

test("a heartbeat client that goes silent is reaped; a client that never promised one is not", async () => {
  const reaped = [];
  const clock = createManualClock();
  const core = heartbeatCore("heartbeat-reaper", 60_000, clock, reaped);

  // A client that never advertised the heartbeat may idle indefinitely: Local
  // Desktop and MCP connections make no liveness promise.
  const quiet = await connectHeartbeatClient(core, []);
  // A client that promised to prove liveness and then went silent is a frozen
  // transport, even though nothing ever reported a close.
  const promised = await connectHeartbeatClient(core, ["connection.heartbeat"]);

  clock.advance(59_999);
  await settled(promised.connection);
  assert.deepEqual(reaped, [], "nobody is reaped before the deadline");

  clock.advance(1);
  await settled(promised.connection);
  assert.deepEqual(reaped, [promised.connection.connectionId],
    "only the connection that promised a heartbeat is reaped for silence");
  assert.equal(quiet.connection.state, "open");

  await quiet.client.close().catch(() => undefined);
  await promised.client.close().catch(() => undefined);
  await Promise.all([quiet.task, promised.task]);
});

test("a heartbeat keeps an idle connection alive indefinitely", async () => {
  const reaped = [];
  const clock = createManualClock();
  const core = heartbeatCore("heartbeat-idle", 60_000, clock, reaped);
  const session = await connectHeartbeatClient(core, ["connection.heartbeat"]);
  try {
    // No terminal output, no workspace events: a quiet workspace stays connected
    // on pings alone, which traffic inference could never distinguish from death.
    // Each ping lands well inside the deadline, and together they span far more
    // than one.
    for (let beat = 0; beat < 10; beat += 1) {
      clock.advance(40_000);
      const pong = await session.client.query("connection.ping", { sentAt: clock.now() });
      assert.equal(pong.ok, true);
    }
    await settled(session.connection);
    assert.deepEqual(reaped, []);
    assert.equal(session.connection.state, "open");
  } finally {
    await session.client.close().catch(() => undefined);
    await session.task;
  }
});

test("a silence deadline that came due while the server was suspended is replaced, not honoured", async () => {
  const reaped = [];
  const clock = createManualClock();
  const core = heartbeatCore("heartbeat-suspended", 60_000, clock, reaped);
  const session = await connectHeartbeatClient(core, ["connection.heartbeat"]);

  // The machine sleeps for ten minutes: the deadline's timer fires on wake,
  // far later by the wall clock than the deadline it was armed with.
  clock.sleep(600_000);
  await settled(session.connection);
  assert.deepEqual(reaped, [], "sleep is not client silence");
  assert.equal(session.connection.state, "open");

  // The fresh deadline runs while the server is awake. A client that is still
  // silent when it elapses really is gone.
  clock.advance(60_000);
  await settled(session.connection);
  assert.deepEqual(reaped, [session.connection.connectionId],
    "the fresh deadline reaps a client that never answered");

  await session.client.close().catch(() => undefined);
  await session.task;
});

test("a client that answers within the fresh deadline after a suspension stays connected", async () => {
  const reaped = [];
  const clock = createManualClock();
  const core = heartbeatCore("heartbeat-resumed", 60_000, clock, reaped);
  const session = await connectHeartbeatClient(core, ["connection.heartbeat"]);
  try {
    clock.sleep(600_000);
    await settled(session.connection);
    for (let beat = 0; beat < 6; beat += 1) {
      const pong = await session.client.query("connection.ping", { sentAt: clock.now() });
      assert.equal(pong.ok, true);
      clock.advance(40_000);
    }
    await settled(session.connection);
    assert.deepEqual(reaped, []);
    assert.equal(session.connection.state, "open");
  } finally {
    await session.client.close().catch(() => undefined);
    await session.task;
  }
});
