import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { decodeFrame, encodeFrame } from "@terminay/protocol";
import { createServerCore, OrderedEventJournal } from "../dist/index.js";

test("closed connections release the server connection limit", async () => {
  const core = createServerCore({
    serverId: "connection-limit-server", serverVersion: "test", capabilities: [], maxConnections: 1,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  const firstPair = createInMemoryTransportPair();
  const first = core.accept(firstPair.server);
  const firstTask = first.start();
  const firstClient = new TerminayClient({ transport: firstPair.client, clientId: "first-client" });
  await firstPair.open();
  await firstClient.connect();
  assert.throws(() => core.accept(createInMemoryTransportPair().server), /connection limit/u);
  await firstClient.close();
  await firstTask;

  const secondPair = createInMemoryTransportPair();
  const second = core.accept(secondPair.server);
  const secondTask = second.start();
  const secondClient = new TerminayClient({ transport: secondPair.client, clientId: "second-client" });
  await secondPair.open();
  await secondClient.connect();
  await secondClient.close();
  await secondTask;
});

test("bounded event replay sends event_resync only to clients that advertised the capability", async () => {
  const journal = new OrderedEventJournal({ maxEvents: 1, snapshot: () => ({ revision: journal.revision, cursor: journal.cursor, payload: { hidden: true } }) });
  journal.append("terminal", { value: 1 });
  journal.append("terminal", { value: 2 });
  const core = createServerCore({
    serverId: "resync-capability-server", serverVersion: "test", capabilities: [], eventJournal: journal,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });

  const legacy = await subscribeWithCapabilities(core, [], "legacy-client");
  assert.equal(legacy.result.type, "command_result");
  assert.equal(await nextFrameOrTimeout(legacy.iterator), undefined);
  await legacy.transport.close();
  await legacy.task;

  const capable = await subscribeWithCapabilities(core, ["events.resync"], "capable-client");
  assert.equal(capable.result.type, "command_result");
  const resync = await nextFrameOrTimeout(capable.iterator);
  assert.deepEqual(resync, { type: "event_resync", subscriptionId: "subscription", revision: 2, cursor: "2" });
  await capable.transport.close();
  await capable.task;
});

test("a failed live event send closes the connection without an unhandled rejection", async () => {
  const journal = new OrderedEventJournal();
  const pair = createInMemoryTransportPair();
  let failSends = false;
  const transport = {
    get state() { return pair.server.state; },
    get incoming() { return pair.server.incoming; },
    get queuedBytes() { return pair.server.queuedBytes; },
    get bufferedBytes() { return pair.server.bufferedBytes; },
    open: (signal) => pair.server.open(signal),
    send: (frame, options) => failSends
      ? Promise.reject(new Error("simulated disconnected event stream"))
      : pair.server.send(frame, options),
    waitForWritable: (requiredBytes, signal) => pair.server.waitForWritable(requiredBytes, signal),
    close: (reason, options) => pair.server.close(reason, options),
    onStateChange: (listener) => pair.server.onStateChange(listener),
  };
  const core = createServerCore({
    serverId: "event-send-failure-server", serverVersion: "test", capabilities: [], eventJournal: journal,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
  });
  const connection = core.accept(transport);
  const task = connection.start();
  await pair.client.open();
  const iterator = pair.client.incoming[Symbol.asyncIterator]();
  await pair.client.send(encodeFrame({
    type: "client_hello", protocolMin: 1, protocolMax: 1, clientId: "event-client", clientVersion: "test", capabilities: ["events.resync"], limits: {},
  }));
  assert.equal(decodeFrame((await iterator.next()).value).envelope.type, "server_hello");
  await pair.client.send(encodeFrame({
    type: "command", commandId: "subscribe-command", correlationId: "subscribe-correlation", operation: "events.subscribe",
    payload: { subscriptionId: "subscription", event: null, fromRevision: 0 },
  }));
  const subscriptionResult = decodeFrame((await iterator.next()).value).envelope;
  assert.equal(subscriptionResult.type, "command_result");
  assert.equal(subscriptionResult.ok, true);
  await new Promise((resolve) => setImmediate(resolve));

  failSends = true;
  journal.append("activity", { status: "working" });

  await task;
  assert.equal(connection.state, "closed");
});

async function subscribeWithCapabilities(core, capabilities, clientId) {
  const pair = createInMemoryTransportPair();
  const connection = core.accept(pair.server);
  const task = connection.start();
  await pair.open();
  const iterator = pair.client.incoming[Symbol.asyncIterator]();
  await pair.client.send(encodeFrame({ type: "client_hello", protocolMin: 1, protocolMax: 1, clientId, clientVersion: "test", capabilities, limits: {} }));
  const hello = decodeFrame((await iterator.next()).value).envelope;
  assert.equal(hello.type, "server_hello");
  await pair.client.send(encodeFrame({
    type: "command", commandId: "subscribe-command", correlationId: "subscribe-correlation", operation: "events.subscribe",
    payload: { subscriptionId: "subscription", event: null, fromRevision: 0 },
  }));
  const result = decodeFrame((await iterator.next()).value).envelope;
  return { iterator, task, transport: pair.client, result };
}

async function nextFrameOrTimeout(iterator) {
  const result = await Promise.race([
    iterator.next(),
    new Promise((resolve) => setTimeout(() => resolve({ done: true }), 25)),
  ]);
  return result.done ? undefined : decodeFrame(result.value).envelope;
}
