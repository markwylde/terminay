import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteConnectionManager,
  RemoteHeadlessWebRtcFactory,
} from "../dist/remote/index.js";

const CHANNELS = ["control", "application", "terminal", "assets"];
const RUNTIMES = ["node-datachannel", "werift", "custom"];

class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.sent = [];
    this.messages = new Set();
    this.states = new Set();
  }

  send(frame) {
    if (this.readyState !== "open") throw new Error("channel is not open");
    this.sent.push(new Uint8Array(frame));
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

  emit(frame) {
    for (const listener of [...this.messages]) listener(new Uint8Array(frame));
  }
}

function fixture({ maxPeers = 8, maxFrameBytes = 4, maxBufferedBytes = 8, maxQueuedBytes = 8 } = {}) {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    maxPeers,
    maxFrameBytes,
    maxQueuedBytes,
    maxAssetQueuedBytes: maxQueuedBytes,
  });
  manager.expose(1_000);
  const channelsByPeer = new Map();
  const adapterCalls = [];
  const factory = new RemoteHeadlessWebRtcFactory({
    manager,
    maxFrameBytes,
    maxBufferedBytes,
    runtimes: RUNTIMES.map((runtime) => ({
      runtime,
      async connect(context) {
        adapterCalls.push({ runtime, context });
        const channels = new Map(CHANNELS.map((label) => [label, new FakeChannel(label)]));
        channelsByPeer.set(context.peerId, channels);
        return channels;
      },
    })),
  });
  const proof = (deviceId, ticketId = `${deviceId}-ticket`) => ({
    ticketId,
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    deviceId,
    expiresAt: 900,
    authenticated: true,
  });
  return { manager, factory, channelsByPeer, adapterCalls, proof, advance: (value) => { now = value; } };
}

test("every injected headless runtime label shares the four-channel bounded contract", async () => {
  const fixtureValue = fixture({ maxFrameBytes: 4, maxBufferedBytes: 4 });
  for (const [index, runtime] of RUNTIMES.entries()) {
    const session = await fixtureValue.factory.connect(runtime, fixtureValue.proof(`device-${index}`));
    const channels = fixtureValue.channelsByPeer.get(session.peerId);
    assert.ok(channels);
    assert.deepEqual([...channels.keys()], CHANNELS);
    assert.deepEqual(
      fixtureValue.adapterCalls[index].context.channels,
      CHANNELS,
      `${runtime} adapter must receive all isolated channels`,
    );

    session.send("control", new Uint8Array([1, 2]));
    assert.deepEqual([...channels.get("control").sent[0]], [1, 2]);
    channels.get("terminal").emit(new Uint8Array([3, 4]));
    assert.deepEqual([...session.drain("terminal")[0]], [3, 4]);

    channels.get("assets").bufferedAmount = 4;
    assert.throws(() => session.send("assets", new Uint8Array([5])), /backpressure/);
    channels.get("application").close();
    assert.equal(session.state, "closed");
    assert.equal(fixtureValue.manager.snapshot().peers.some((peer) => peer.peerId === session.peerId), false);
  }
});

test("headless runtime adapters reject resource overcommit before adapter invocation", async () => {
  const fixtureValue = fixture({ maxPeers: 1 });
  await fixtureValue.factory.connect("node-datachannel", fixtureValue.proof("device-a"));
  await assert.rejects(
    () => fixtureValue.factory.connect("werift", fixtureValue.proof("device-b")),
    /peer limit/,
  );
  assert.equal(fixtureValue.adapterCalls.length, 1, "runtime adapter must not run for a peer-limit rejection");
  assert.equal(fixtureValue.manager.snapshot().peers.length, 1);
});

test("revocation closes only the matching headless runtime session and clears its queues", async () => {
  const fixtureValue = fixture({ maxFrameBytes: 8, maxQueuedBytes: 8 });
  const first = await fixtureValue.factory.connect("node-datachannel", fixtureValue.proof("device-a"));
  const second = await fixtureValue.factory.connect("werift", fixtureValue.proof("device-b"));
  const firstChannels = fixtureValue.channelsByPeer.get(first.peerId);
  const secondChannels = fixtureValue.channelsByPeer.get(second.peerId);
  firstChannels.get("terminal").emit(new Uint8Array([1, 2]));
  secondChannels.get("terminal").emit(new Uint8Array([3, 4]));

  assert.equal(await fixtureValue.factory.revokeDevice("device-a"), 1);
  assert.equal(first.state, "closed");
  assert.equal(second.state, "connected");
  assert.equal(firstChannels.get("control").readyState, "closed");
  assert.equal(secondChannels.get("control").readyState, "open");
  assert.equal(
    fixtureValue.manager.snapshot().peers.some((peer) => peer.peerId === first.peerId),
    false,
    "revoked headless peers are removed after channel cleanup",
  );
  assert.deepEqual([...second.drain("terminal")[0]], [3, 4]);
  await fixtureValue.factory.closeAll();
});

test("origin mismatch and expired exposure fail before headless adapter allocation", async () => {
  const identity = fixture();
  await assert.rejects(
    () => identity.factory.connect("custom", {
      ...identity.proof("device-a"),
      sessionOrigin: "https://other.example.test",
    }),
    /identity mismatch/,
  );
  assert.equal(identity.adapterCalls.length, 0);
  const expired = fixture();
  expired.advance(1_000);
  await assert.rejects(
    () => expired.factory.connect("custom", expired.proof("device-a")),
    /unavailable/,
  );
  assert.equal(expired.adapterCalls.length, 0);
});
