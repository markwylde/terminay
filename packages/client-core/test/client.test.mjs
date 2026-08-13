import test from "node:test";
import assert from "node:assert/strict";
import { decodeFrame, encodeFrame, DEFAULT_PROTOCOL_LIMITS } from "@terminay/protocol";
import { ClientDisconnectedError, FileObservationClient, createHostCapabilityProvider, TerminayClient } from "../dist/index.js";

test("host capabilities are normalized and enforced", () => {
  const host = createHostCapabilityProvider({ clipboard: true, nativeWindows: false });
  assert.equal(host.has("clipboard"), true);
  assert.equal(host.has("nativeWindows"), false);
  assert.throws(() => host.require("nativeWindows"), /unavailable/);
});

function createTransport() {
  const frames = [];
  const queued = [];
  let waiter;
  let closed = false;

  const incoming = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queued.length > 0) return Promise.resolve({ value: queued.shift(), done: false });
          if (closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => { waiter = resolve; });
        },
        return() {
          closed = true;
          waiter?.({ value: undefined, done: true });
          waiter = undefined;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return {
    state: "open",
    incoming,
    queuedBytes: 0,
    bufferedBytes: 0,
    frames,
    open: async () => {},
    async send(frame, options = {}) {
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      frames.push(decodeFrame(frame));
    },
    waitForWritable: async () => {},
    async close() {
      closed = true;
      waiter?.({ value: undefined, done: true });
      waiter = undefined;
    },
    onStateChange: () => () => {},
		end() {
			closed = true;
			waiter?.({ value: undefined, done: true });
			waiter = undefined;
		},
    push(envelope) {
      const frame = encodeFrame(envelope, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS);
      if (waiter !== undefined) {
        const resolve = waiter;
        waiter = undefined;
        resolve({ value: frame, done: false });
      } else {
        queued.push(frame);
      }
    },
  };
}

test("disconnect marks confirmed state stale and a fresh client resumes subscriptions from its watermark", async () => {
	const first = await connectedClient();
	first.transport.push({
		type: "event",
		subscriptionId: "unrouted",
		revision: 7,
		cursor: "7",
		event: "workspace.changed",
		payload: {},
	});
	await new Promise((resolve) => setImmediate(resolve));
	first.transport.end();
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepEqual(
		{
			state: first.client.snapshot.state,
			stale: first.client.snapshot.stale,
			revision: first.client.snapshot.revision,
			cursor: first.client.snapshot.cursor,
		},
		{ state: "stale", stale: true, revision: 7, cursor: "7" },
	);
	await assert.rejects(first.client.command("workspace.mutate"), /not connected/u);

	const secondTransport = createTransport();
	const secondClient = new TerminayClient({
		transport: secondTransport,
		clientId: "test-client-reconnected",
		initialWatermark: { revision: 7, cursor: "7" },
	});
	assert.notEqual(secondTransport, first.transport);
	const connecting = secondClient.connect();
	secondTransport.push({
		type: "server_hello",
		protocolVersion: 1,
		serverId: "server-1",
		serverVersion: "test",
		clientId: "test-client-reconnected",
		capabilities: [],
		limits: DEFAULT_PROTOCOL_LIMITS,
		authScope: "write",
	});
	await connecting;
	const subscribing = secondClient.subscribe("workspace.changed", {
		subscriptionId: "workspace-resume",
	});
	const subscribeFrame = secondTransport.frames.find(
		({ envelope }) =>
			envelope.type === "command" && envelope.operation === "events.subscribe",
	);
	assert.deepEqual(subscribeFrame.envelope.payload, {
		subscriptionId: "workspace-resume",
		event: "workspace.changed",
		fromRevision: 7,
		cursor: "7",
	});
	secondTransport.push({
		type: "command_result",
		commandId: subscribeFrame.envelope.commandId,
		correlationId: subscribeFrame.envelope.correlationId,
		ok: true,
		result: { subscriptionId: "workspace-resume" },
	});
	await subscribing;
	await secondClient.close();
});

test("a reconnect watermark must be canonical and internally consistent", () => {
	for (const initialWatermark of [
		{ revision: -1, cursor: "-1" },
		{ revision: 4, cursor: "3" },
		{ revision: 4, cursor: "workspace-secret" },
	]) {
		assert.throws(
			() => new TerminayClient({ transport: createTransport(), initialWatermark }),
			/initial connection watermark is invalid/u,
		);
	}
});

async function connectedClient() {
  const transport = createTransport();
  const client = new TerminayClient({ transport, clientId: "test-client" });
  const connecting = client.connect();
  transport.push({
    type: "server_hello",
    protocolVersion: 1,
    serverId: "server-1",
    serverVersion: "test",
    clientId: "test-client",
    capabilities: [],
    limits: DEFAULT_PROTOCOL_LIMITS,
    authScope: "write",
  });
  await connecting;
  return { client, transport };
}

test("live terminal presentation does not move the durable connection watermark backwards", async () => {
  const { client, transport } = await connectedClient();
  transport.push({
    type: "event",
    subscriptionId: "unrouted",
    revision: 7,
    cursor: "7",
    event: "workspace.changed",
    payload: {},
  });
  transport.push({
    type: "event",
    subscriptionId: "unrouted",
    revision: 6,
    cursor: "6",
    event: "terminal",
    payload: { type: "output", attachmentId: "attachment-a" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.snapshot.revision, 7);
  assert.equal(client.snapshot.cursor, "7");
  await client.close();
});

test("aborting an accepted command sends one validated cancel frame for its correlation", async () => {
  const { client, transport } = await connectedClient();
  const controller = new AbortController();
  const command = client.command("workspace.slow", {}, { signal: controller.signal });
  const commandFrame = transport.frames.find(({ envelope }) => envelope.type === "command");
  assert.ok(commandFrame);

  controller.abort();
  await assert.rejects(command, (error) => error?.name === "AbortError");

  const cancelFrames = transport.frames.filter(({ envelope }) => envelope.type === "cancel");
  assert.equal(cancelFrames.length, 1);
  assert.deepEqual(cancelFrames[0].envelope, {
    type: "cancel",
    correlationId: commandFrame.envelope.correlationId,
    reason: "client-abort",
  });
  await client.close();
});

test("a pre-aborted command does not send a command or cancel frame", async () => {
  const { client, transport } = await connectedClient();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(client.command("workspace.never", {}, { signal: controller.signal }), (error) => error?.name === "AbortError");
  assert.deepEqual(transport.frames.filter(({ envelope }) => envelope.type === "command" || envelope.type === "cancel"), []);
  await client.close();
});

test("a response that wins before abort does not produce a cancel frame", async () => {
  const { client, transport } = await connectedClient();
  const controller = new AbortController();
  const command = client.command("workspace.fast", {}, { signal: controller.signal });
  const commandFrame = transport.frames.find(({ envelope }) => envelope.type === "command");
  assert.ok(commandFrame);

  transport.push({ type: "command_result", commandId: commandFrame.envelope.commandId, correlationId: commandFrame.envelope.correlationId, ok: true, result: { done: true } });
  assert.equal((await command).result.done, true);
  controller.abort();
  await Promise.resolve();
  assert.equal(transport.frames.some(({ envelope }) => envelope.type === "cancel"), false);
  await client.close();
});

test("an in-flight web terminal write becomes outcome-unknown when its WebRTC client disconnects", async () => {
  const transport = createTransport();
  const client = new TerminayClient({ transport, clientId: "web-webrtc-reproduction" });
  const connecting = client.connect();
  transport.push({
    type: "server_hello",
    protocolVersion: 1,
    serverId: "server-1",
    serverVersion: "test",
    clientId: "web-webrtc-reproduction",
    capabilities: [],
    limits: DEFAULT_PROTOCOL_LIMITS,
    authScope: "write",
  });
  await connecting;

  const pendingWrite = client.command("terminal.write", {
    attachmentId: "attachment-mobile",
    bytes: [97],
  });
  const sentWrite = transport.frames.find(
    ({ envelope }) => envelope.type === "command" && envelope.operation === "terminal.write",
  );
  assert.ok(sentWrite, "the terminal write reached the transport before it disconnected");

  transport.end();

  await assert.rejects(pendingWrite, (error) => {
    assert.equal(error?.name, "CommandOutcomeUnknownError");
    assert.equal(error?.message, `command outcome is unknown: ${sentWrite.envelope.commandId}`);
    assert.match(error?.commandId ?? "", /^web-webrtc-reproduction-/);
    return true;
  });
});

test("subscription buffers an initial replay until its caller attaches a listener", async () => {
  const { client, transport } = await connectedClient();
  const subscribing = client.subscribe("agent", { subscriptionId: "agent-subscription" });
  const subscribeFrame = transport.frames.find(({ envelope }) => envelope.type === "command" && envelope.operation === "events.subscribe");
  assert.ok(subscribeFrame);
  transport.push({ type: "command_result", commandId: subscribeFrame.envelope.commandId, correlationId: subscribeFrame.envelope.correlationId, ok: true, result: { subscriptionId: "agent-subscription" } });
  transport.push({ type: "event", subscriptionId: "agent-subscription", revision: 2, cursor: "2", event: "agent", payload: { revision: 2 } });
  const subscription = await subscribing;
  await new Promise((resolve) => setImmediate(resolve));
  const received = [];
  subscription.onEvent((event) => received.push(event.revision));
  assert.deepEqual(received, [2]);
  await client.close();
});

test("subscription exposes an explicit bounded-replay resync signal", async () => {
  const { client, transport } = await connectedClient();
  const subscribing = client.subscribe("agent", { subscriptionId: "agent-resync" });
  const subscribeFrame = transport.frames.find(({ envelope }) => envelope.type === "command" && envelope.operation === "events.subscribe");
  assert.ok(subscribeFrame);
  transport.push({ type: "command_result", commandId: subscribeFrame.envelope.commandId, correlationId: subscribeFrame.envelope.correlationId, ok: true, result: { subscriptionId: "agent-resync" } });
  const subscription = await subscribing;
  const received = [];
  const remove = subscription.onResync((resync) => received.push(resync));
  transport.push({ type: "event_resync", subscriptionId: "agent-resync", revision: 8, cursor: "8" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ subscriptionId: "agent-resync", revision: 8, cursor: "8" }]);
  assert.equal(client.snapshot.stale, true);
  const late = [];
  subscription.onResync((resync) => late.push(resync));
  assert.deepEqual(late, [{ subscriptionId: "agent-resync", revision: 8, cursor: "8" }]);
  const events = [];
  subscription.onEvent((event) => events.push(event.revision));
  transport.push({ type: "event", subscriptionId: "agent-resync", revision: 9, cursor: "9", event: "agent", payload: { revision: 9 } });
  transport.push({ type: "event_resync", subscriptionId: "agent-resync", revision: 10, cursor: "10" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  assert.deepEqual(received, [{ subscriptionId: "agent-resync", revision: 8, cursor: "8" }]);
  remove();
  await client.close();
});

test("subscription unsubscribe after client close is local and idempotent", async () => {
  const { client, transport } = await connectedClient();
  const subscribing = client.subscribe("workspace.changed", { subscriptionId: "workspace-subscription" });
  const subscribeFrame = transport.frames.find(({ envelope }) => envelope.type === "command" && envelope.operation === "events.subscribe");
  assert.ok(subscribeFrame);
  transport.push({ type: "command_result", commandId: subscribeFrame.envelope.commandId, correlationId: subscribeFrame.envelope.correlationId, ok: true, result: { subscriptionId: "workspace-subscription" } });
  const subscription = await subscribing;

  await client.close();
  await assert.doesNotReject(subscription.unsubscribe());
  await assert.doesNotReject(subscription.unsubscribe());

  assert.equal(
    transport.frames.some(({ envelope }) => envelope.type === "command" && envelope.operation === "events.unsubscribe"),
    false,
  );
});

test("file observation stop cleanup suppresses expected disconnect failures", async () => {
  const client = new FileObservationClient({
    query: async () => null,
    command: async () => {
      throw new ClientDisconnectedError();
    },
    subscribeEvents: async () => () => {},
  });

  await assert.doesNotReject(client.stopWatch("watch-a"));
  await assert.doesNotReject(client.cancelFolderSize("size-a"));
});

test("an unbounded ready frame stream yields to timers", async () => {
  const hello = encodeFrame({
    type: "server_hello",
    protocolVersion: 1,
    serverId: "server",
    serverVersion: "test",
    clientId: "client",
    capabilities: [],
    limits: DEFAULT_PROTOCOL_LIMITS,
    authScope: "write",
  }, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS);
  const event = encodeFrame({
    type: "event",
    subscriptionId: "missing",
    revision: 1,
    cursor: "1",
    event: "test",
    payload: {},
  }, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS);
  let first = true;
  let closed = false;
  const transport = {
    state: "open",
    incoming: {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (closed) return { done: true, value: undefined };
            const value = first ? hello : event;
            first = false;
            return { done: false, value };
          },
        };
      },
    },
    queuedBytes: 0,
    bufferedBytes: 0,
    open: async () => {},
    send: async () => {},
    waitForWritable: async () => {},
    close: async () => { closed = true },
    onStateChange: () => () => {},
  };
  const client = new TerminayClient({ transport, clientId: "client" });
  await client.connect();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("reader starved the timer")), 250);
    setTimeout(() => {
      clearTimeout(timeout);
      resolve();
    }, 0);
  });
  await client.close();
});
