import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteConnectionManager,
  RemoteHeadlessWebRtcFactory,
} from "@terminay/server-core";
import {
  createNodeDataChannelRuntimeAdapter,
  loadNodeDataChannelRuntimeModule,
} from "../dist/index.js";

const CHANNELS = ["control", "application", "terminal", "assets"];

class FakeNativeChannel {
  constructor(label) {
    this.label = label;
    this.open = true;
    this.buffered = 0;
    this.sent = [];
    this.messages = new Set();
    this.closed = new Set();
    this.closeCalls = 0;
  }

  getLabel() { return this.label; }
  isOpen() { return this.open; }
  bufferedAmount() { return this.buffered; }
  sendMessageBinary(frame) {
    if (!this.open) return false;
    this.sent.push(new Uint8Array(frame));
    return true;
  }
  onMessage(listener) { this.messages.add(listener); }
  onClosed(listener) { this.closed.add(listener); }
  emit(frame) { for (const listener of [...this.messages]) listener(frame); }
  close() {
    this.closeCalls += 1;
    if (!this.open) return;
    this.open = false;
    for (const listener of [...this.closed]) listener();
  }
}

function fakeModule() {
  return { PeerConnection: class PeerConnection {} };
}

function proof(deviceId, ticketId = `${deviceId}-ticket`) {
  return {
    ticketId,
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    deviceId,
    expiresAt: 900,
    authenticated: true,
  };
}

test("loader validates an optional native module without importing it into server-core", async () => {
  const loaded = await loadNodeDataChannelRuntimeModule(
    "data:text/javascript,export%20class%20PeerConnection%20%7B%7D",
  );
  assert.equal(typeof loaded.PeerConnection, "function");
  await assert.rejects(
    () => loadNodeDataChannelRuntimeModule("data:text/javascript,export%20const%20notRuntime%20%3D%201"),
    /PeerConnection/,
  );
});

test("node-datachannel adapter maps native channels into server-owned lifecycle", async () => {
  let loadCount = 0;
  const nativeByLabel = new Map();
  const adapter = createNodeDataChannelRuntimeAdapter({
    loadModule: async () => {
      loadCount += 1;
      return fakeModule();
    },
    openChannels: async (_module, context) => {
      assert.equal(context.serverId, "server-a");
      assert.equal(context.sessionOrigin, "https://session.example.test");
      const channels = new Map(CHANNELS.map((label) => {
        const channel = new FakeNativeChannel(label);
        nativeByLabel.set(label, channel);
        return [label, channel];
      }));
      return channels;
    },
  });

  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
    maxFrameBytes: 16,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({
    manager,
    maxFrameBytes: 16,
    runtimes: [adapter],
  });
  const session = await factory.connect("node-datachannel", proof("device-a"));
  assert.equal(loadCount, 1);
  const firstAssets = nativeByLabel.get("assets");
  const firstControl = nativeByLabel.get("control");
  const firstTerminal = nativeByLabel.get("terminal");
  const second = await factory.connect("node-datachannel", proof("device-a-2"));
  assert.equal(loadCount, 1, "the optional native module is loaded once per adapter");
  await second.close();
  session.send("control", new Uint8Array([1, 2]));
  assert.deepEqual([...firstControl.sent[0]], [1, 2]);
  firstTerminal.emit(new Uint8Array([3, 4]));
  assert.deepEqual([...session.drain("terminal")[0]], [3, 4]);

  firstAssets.close();
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
  await factory.closeAll();
});

test("native send rejection immediately closes the authenticated peer", async () => {
	const channel = new FakeNativeChannel("control");
	channel.sendMessageBinary = () => false;
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
  });
  const manager = new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: "https://session.example.test", now: () => 100 });
	manager.expose(1_000);
	const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });
	const session = await factory.connect("node-datachannel", proof("device-b"));
	assert.throws(() => session.send("control", new Uint8Array([1])), /rejected/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(channel.closeCalls, 1);
	assert.equal(session.state, "closed");
	assert.equal(manager.snapshot().peers.length, 0);
});

test("native send exceptions immediately close the authenticated peer", async () => {
	const channel = new FakeNativeChannel("control");
	channel.sendMessageBinary = () => { throw new Error("native write failed"); };
	const adapter = createNodeDataChannelRuntimeAdapter({
		module: fakeModule(),
		openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
	});
	const manager = new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: "https://session.example.test", now: () => 100 });
	manager.expose(1_000);
	const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });
	const session = await factory.connect("node-datachannel", proof("device-throwing-send"));

	assert.throws(() => session.send("control", new Uint8Array([1])), /rejected/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(channel.closeCalls, 1);
	assert.equal(session.state, "closed");
	assert.equal(manager.snapshot().peers.length, 0);
});

test("non-binary native messages fail closed", async () => {
	const channel = new FakeNativeChannel("control");
	const adapter = createNodeDataChannelRuntimeAdapter({
		module: fakeModule(),
		openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
	});
	const manager = new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: "https://session.example.test", now: () => 100 });
	manager.expose(1_000);
	const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });
	const session = await factory.connect("node-datachannel", proof("device-non-binary"));

	channel.emit("not-binary");

	assert.equal(channel.closeCalls, 1);
	assert.equal(session.state, "closed");
	assert.equal(manager.snapshot().peers.length, 0);
});

test("an inbound transport handler exception fails closed at the native boundary", async () => {
  const channel = new FakeNativeChannel("control");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map([["control", channel]]),
  });
  const channels = await adapter.connect({
    peerId: "peer-handler-throw",
    deviceId: "device-handler-throw",
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    channels: ["control"],
    maxFrameBytes: 16,
    maxBufferedBytes: 64,
    signal: new AbortController().signal,
  });
  const wrapped = channels.get("control");
  wrapped.onMessage(() => { throw new Error("server transport rejected frame"); });

  assert.doesNotThrow(() => channel.emit(new Uint8Array([1, 2])));

  assert.equal(channel.closeCalls, 1);
  assert.equal(wrapped.readyState, "closed");
});

test("throwing lifecycle observers cannot escape a native close callback or block cleanup", async () => {
  const channel = new FakeNativeChannel("control");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map([["control", channel]]),
  });
  const channels = await adapter.connect({
    peerId: "peer-lifecycle-observer-throw",
    deviceId: "device-lifecycle-observer-throw",
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    channels: ["control"],
    maxFrameBytes: 16,
    maxBufferedBytes: 64,
    signal: new AbortController().signal,
  });
  const wrapped = channels.get("control");
  wrapped.onStateChange(() => { throw new Error("observer failed"); });

  assert.doesNotThrow(() => channel.close());
  assert.equal(channel.closeCalls, 1);
  assert.equal(wrapped.readyState, "closed");
});

test("a throwing native close cannot escape explicit server-owned cleanup", async () => {
  const channel = new FakeNativeChannel("control");
  channel.close = () => {
    channel.closeCalls += 1;
    throw new Error("native close failed");
  };
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map([["control", channel]]),
  });
  const channels = await adapter.connect({
    peerId: "peer-explicit-close-throw",
    deviceId: "device-explicit-close-throw",
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    channels: ["control"],
    maxFrameBytes: 16,
    maxBufferedBytes: 64,
    signal: new AbortController().signal,
  });
  const wrapped = channels.get("control");
  const states = [];
  wrapped.onStateChange((state) => states.push(state));

  assert.doesNotThrow(() => wrapped.close());
  assert.equal(channel.closeCalls, 1);
  assert.equal(wrapped.readyState, "closed");
  assert.deepEqual(states, ["closing", "closed"]);
});

test("oversized native frames fail closed before they are copied into the transport", async () => {
  const channel = new FakeNativeChannel("control");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
    maxFrameBytes: 16,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, maxFrameBytes: 16, runtimes: [adapter] });
  const session = await factory.connect("node-datachannel", proof("device-oversized-frame"));

  channel.emit(new Uint8Array(17));

  assert.equal(channel.closeCalls, 1);
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
});

test("a frame received after native closure fails closed instead of entering the transport", async () => {
  const channel = new FakeNativeChannel("control");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
    maxFrameBytes: 16,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, maxFrameBytes: 16, runtimes: [adapter] });
  const session = await factory.connect("node-datachannel", proof("device-stale-native-frame"));

  // Model a native close transition whose callback is delayed. A valid frame
  // must not cross that lifecycle boundary into the server-owned queue.
  channel.open = false;
  channel.emit(new Uint8Array([7, 8]));

  assert.throws(() => session.drain("control"), /remote session is closed/);
  assert.equal(channel.closeCalls, 1);
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
});

test("invalid native buffered amounts fail closed and release the authenticated peer", async () => {
  const channel = new FakeNativeChannel("control");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map(CHANNELS.map((label) => [label, label === "control" ? channel : new FakeNativeChannel(label)])),
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
    maxFrameBytes: 16,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, maxFrameBytes: 16, runtimes: [adapter] });
  const session = await factory.connect("node-datachannel", proof("device-invalid-buffer"));

  channel.buffered = -1;
  assert.throws(() => session.send("control", new Uint8Array([1])), /buffered amount is invalid/);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(channel.closeCalls, 1);
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
});

test("a malformed native channel set closes every allocated native channel before rejecting", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  nativeByLabel.get("terminal").getLabel = () => "wrong-label";
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(factory.connect("node-datachannel", proof("device-malformed")), /invalid/);
  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.open, false, `${channel.label} must be closed`);
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("an unexpected native traffic lane is rejected before any channel is adapted or admitted", async () => {
  const control = new FakeNativeChannel("control");
  const assets = new FakeNativeChannel("assets");
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => new Map([["control", control], ["assets", assets]]),
  });

  await assert.rejects(
    adapter.connect({
      peerId: "peer-unexpected-native-lane",
      deviceId: "device-unexpected-native-lane",
      serverId: "server-a",
      sessionOrigin: "https://session.example.test",
      channels: ["control"],
      maxFrameBytes: 16,
      maxBufferedBytes: 64,
      signal: new AbortController().signal,
    }),
    /does not match the requested contract/,
  );

  assert.equal(control.closeCalls, 1);
  assert.equal(assets.closeCalls, 1);
});

test("a native channel cannot be allocated to multiple isolated traffic labels", async () => {
  const shared = new FakeNativeChannel("control");
  const terminal = new FakeNativeChannel("terminal");
  const assets = new FakeNativeChannel("assets");
  const nativeByLabel = new Map([
    ["control", shared],
    ["application", shared],
    ["terminal", terminal],
    ["assets", assets],
  ]);
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(
    factory.connect("node-datachannel", proof("device-duplicate-native-channel")),
    /allocation is not isolated/,
  );

  assert.equal(manager.snapshot().peers.length, 0);
  assert.equal(shared.closeCalls, 1, "the reused native channel is closed once");
  assert.equal(terminal.closeCalls, 1);
  assert.equal(assets.closeCalls, 1);
});

test("a native channel already closed during admission rejects and cleans up the whole allocation", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  nativeByLabel.get("terminal").open = false;
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(factory.connect("node-datachannel", proof("device-closed-at-admission")), /not open during admission/);

  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("an aborted setup closes a late native allocation before authenticated admission", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  const controller = new AbortController();
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: async () => {
      controller.abort(new Error("remote setup was revoked"));
      return nativeByLabel;
    },
  });

  await assert.rejects(
    adapter.connect({
      peerId: "peer-aborted-native-allocation",
      deviceId: "device-aborted-native-allocation",
      serverId: "server-a",
      sessionOrigin: "https://session.example.test",
      channels: CHANNELS,
      maxFrameBytes: 16,
      maxBufferedBytes: 64,
      signal: controller.signal,
    }),
    /revoked/,
  );

  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("a native channel that closes while listeners are registered is never admitted", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  const control = nativeByLabel.get("control");
  control.onClosed = (listener) => {
    control.closed.add(listener);
    // Model a native close racing the listener-registration boundary after the
    // initial admission probe has already observed the channel as open. A
    // native close callback means the channel has actually closed; model that
    // complete transition rather than only invoking its observer.
    control.close();
  };
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(
    factory.connect("node-datachannel", proof("device-closed-during-listener-registration")),
    /closed during listener registration/,
  );

  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("a native listener-registration failure rejects before authenticated admission and cleans up every channel", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  nativeByLabel.get("control").onMessage = () => { throw new Error("native listener registration failed"); };
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(
    factory.connect("node-datachannel", proof("device-listener-registration-throw")),
    /listener registration failed/,
  );

  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("a close reported during lifecycle registration is not closed twice when registration then throws", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  const control = nativeByLabel.get("control");
  control.onClosed = (listener) => {
    control.closed.add(listener);
    control.close();
    throw new Error("native lifecycle registration failed after close");
  };
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(
    factory.connect("node-datachannel", proof("device-close-then-registration-throw")),
    /listener registration failed/,
  );

  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, `${channel.label} must be closed exactly once`);
  }
});

test("a throwing native label getter rejects before admission and cleans up the full allocation", async () => {
  const nativeByLabel = new Map(CHANNELS.map((label) => [label, new FakeNativeChannel(label)]));
  const control = nativeByLabel.get("control");
  control.getLabel = () => { throw new Error("native label lookup failed"); };
  const adapter = createNodeDataChannelRuntimeAdapter({
    module: fakeModule(),
    openChannels: () => nativeByLabel,
  });
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
  });
  manager.expose(1_000);
  const factory = new RemoteHeadlessWebRtcFactory({ manager, runtimes: [adapter] });

  await assert.rejects(
    factory.connect("node-datachannel", proof("device-throwing-label-getter")),
    /channel is invalid/,
  );

  assert.equal(manager.snapshot().peers.length, 0);
  for (const channel of nativeByLabel.values()) {
    assert.equal(channel.closeCalls, 1, "every native lane must close exactly once");
  }
});
