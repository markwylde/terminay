import assert from "node:assert/strict";
import test from "node:test";
import { RemoteConnectionManager, RemoteHeadlessWebRtcFactory } from "../dist/remote/index.js";

const CHANNELS = ["control", "application", "terminal", "assets"];

class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.messages = new Set();
    this.states = new Set();
  }

  send() {
    if (this.readyState !== "open") throw new Error("channel is not open");
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    for (const listener of [...this.states]) listener("closed");
  }

  onMessage(listener) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  onStateChange(listener) {
    this.states.add(listener);
    return () => this.states.delete(listener);
  }
}

function fixture() {
  const manager = new RemoteConnectionManager({
    serverId: "server-storm",
    sessionOrigin: "https://session.example.test",
    maxPeers: 8,
    maxQueuedBytes: 32,
    maxAssetQueuedBytes: 32,
  });
  manager.expose(Date.now() + 60_000);
  const channelsByPeer = new Map();
  const factory = new RemoteHeadlessWebRtcFactory({
    manager,
    runtimes: [{
      runtime: "custom",
      async connect({ peerId }) {
        const channels = new Map(CHANNELS.map((label) => [label, new FakeChannel(label)]));
        channelsByPeer.set(peerId, channels);
        return channels;
      },
    }],
  });
  const proof = (ticketId) => ({
    ticketId,
    serverId: "server-storm",
    sessionOrigin: "https://session.example.test",
    deviceId: "device-storm",
    expiresAt: Date.now() + 60_000,
    authenticated: true,
  });
  return { manager, factory, channelsByPeer, proof };
}

test("revocation closes every session in a disconnect storm and fences future admission", async () => {
  const value = fixture();
  const sessions = await Promise.all([
    value.factory.connect("custom", value.proof("ticket-a")),
    value.factory.connect("custom", value.proof("ticket-b")),
    value.factory.connect("custom", value.proof("ticket-c")),
  ]);

  const revoked = await value.factory.revokeDevice("device-storm");
  assert.equal(revoked, sessions.length);
  assert.deepEqual(value.manager.snapshot().peers, []);
  for (const session of sessions) {
    assert.equal(session.state, "closed");
    const channels = value.channelsByPeer.get(session.peerId);
    assert.ok(channels);
    assert.deepEqual([...channels.values()].map((channel) => channel.readyState), CHANNELS.map(() => "closed"));
    assert.throws(() => session.send("control", new Uint8Array([1])), /closed/);
  }

  await assert.rejects(
    () => value.factory.connect("custom", value.proof("ticket-after-revoke")),
    /revoked/,
  );
  await Promise.all(sessions.map((session) => session.close()));
  assert.deepEqual(value.manager.snapshot().peers, []);
});

test("simultaneous channel loss tears down each session without retaining peers", async () => {
  const value = fixture();
  const sessions = await Promise.all([
    value.factory.connect("custom", value.proof("ticket-one")),
    value.factory.connect("custom", value.proof("ticket-two")),
  ]);
  for (const session of sessions) value.channelsByPeer.get(session.peerId).get("application").close();
  await Promise.all(sessions.map(async (session) => {
    for (let attempt = 0; attempt < 4 && session.state !== "closed"; attempt += 1) await Promise.resolve();
    assert.equal(session.state, "closed");
  }));
  assert.deepEqual(value.manager.snapshot().peers, []);
  await value.factory.closeAll();
});

test("closeAll fences a pending data-channel negotiation and permits a clean reconnect", async () => {
  const manager = new RemoteConnectionManager({
    serverId: "server-storm",
    sessionOrigin: "https://session.example.test",
    maxPeers: 1,
  });
  manager.expose(Date.now() + 60_000);
  let resolveFirst;
  let firstSignal;
  let connectCount = 0;
  const factory = new RemoteHeadlessWebRtcFactory({
    manager,
    runtimes: [{
      runtime: "custom",
      async connect({ signal }) {
        connectCount += 1;
        if (connectCount === 1) {
          firstSignal = signal;
          return await new Promise((resolve) => { resolveFirst = resolve; });
        }
        return new Map(CHANNELS.map((label) => [label, new FakeChannel(label)]));
      },
    }],
  });
  const proof = (ticketId) => ({
    ticketId,
    serverId: "server-storm",
    sessionOrigin: "https://session.example.test",
    deviceId: "device-storm",
    expiresAt: Date.now() + 60_000,
    authenticated: true,
  });

  const pending = factory.connect("custom", proof("ticket-pending"));
  await Promise.resolve();
  assert.equal(manager.snapshot().peers.length, 1, "pending negotiation holds one bounded admission slot");

  await factory.closeAll();
  assert.equal(firstSignal.aborted, true, "shutdown aborts the adapter negotiation");
  assert.deepEqual(manager.snapshot().peers, [], "shutdown releases the pending peer immediately");

  const lateChannels = new Map(CHANNELS.map((label) => [label, new FakeChannel(label)]));
  resolveFirst(lateChannels);
  await assert.rejects(() => pending, /abort/i);
  assert.deepEqual([...lateChannels.values()].map((channel) => channel.readyState), CHANNELS.map(() => "closed"));
  assert.deepEqual(factory.listSessions(), [], "a late runtime result cannot resurrect a session");

  const reconnected = await factory.connect("custom", proof("ticket-reconnect"));
  assert.equal(reconnected.state, "connected");
  await factory.closeAll();
});

test("an invalid server clock disables new remote admission without poisoning existing session metadata", () => {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-clock",
    sessionOrigin: "https://session.example.test",
    now: () => now,
  });
  manager.expose(300);
  const connected = manager.admit({
    ticketId: "ticket-before-clock-failure",
    serverId: "server-clock",
    sessionOrigin: "https://session.example.test",
    deviceId: "device-clock",
    expiresAt: 300,
    authenticated: true,
  });

  now = Number.NaN;
  assert.deepEqual(manager.exposure, { state: "disabled" });
  assert.throws(
    () => manager.admit({
      ticketId: "ticket-during-clock-failure",
      serverId: "server-clock",
      sessionOrigin: "https://session.example.test",
      deviceId: "device-clock",
      expiresAt: 300,
      authenticated: true,
    }),
    /clock is invalid/,
  );
  assert.throws(
    () => manager.send(connected.peerId, "control", new Uint8Array([1])),
    /clock is invalid/,
  );
  assert.equal(manager.snapshot().peers[0]?.lastSeenAt, 100);

  now = 200;
  assert.throws(
    () => manager.admit({
      ticketId: "ticket-before-reexposure",
      serverId: "server-clock",
      sessionOrigin: "https://session.example.test",
      deviceId: "device-clock",
      expiresAt: 300,
      authenticated: true,
    }),
    /exposure is unavailable/,
  );
  manager.expose(400);
  assert.equal(manager.exposure.state, "exposed");
});
