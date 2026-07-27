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

test("native send rejection and non-binary messages fail closed", async () => {
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
  channel.emit("not-binary");
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
});
