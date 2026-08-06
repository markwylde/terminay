import test from "node:test";
import assert from "node:assert/strict";
import { encodeFrame } from "@terminay/protocol";
import { WebSocketByteTransport } from "../dist/index.js";

test("WebSocketByteTransport opens one authenticated framed stream", async () => {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = FakeWebSocket.OPEN;
    bufferedAmount = 0;
    sent = [];
    listeners = new Map();
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      sockets.push(this);
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "" });
    }
    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  const transport = new WebSocketByteTransport({
    origin: "http://127.0.0.1:4317",
    authToken: "pairing-token-123456",
    WebSocket: FakeWebSocket,
  });
  const opening = transport.open();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "ws://127.0.0.1:4317/protocol/stream");
  assert.deepEqual(sockets[0].protocols, [
    "terminay.v1",
    "terminay.auth.cGFpcmluZy10b2tlbi0xMjM0NTY",
  ]);
  sockets[0].emit("open");
  await opening;
  assert.equal(transport.state, "open");

  const frame = encodeFrame({
    type: "client_hello",
    protocolMin: 1,
    protocolMax: 1,
    clientId: "client-a",
    clientVersion: "1.0.0",
    capabilities: [],
    limits: {},
  });
  await transport.send(frame);
  assert.equal(sockets[0].sent.length, 1);
  assert.equal(sockets[0].sent[0], frame);
});

test("WebSocketByteTransport fails when the underlying socket half-closes or rejects send", async (t) => {
  for (const mode of ["half-close", "callback", "throw"]) {
    await t.test(mode, async () => {
      const socket = new LifecycleWebSocket();
      const transport = new WebSocketByteTransport({
        origin: "http://127.0.0.1:4317",
        authToken: "pairing-token-123456",
        WebSocket: function FakeWebSocketConstructor() { return socket; },
        maxFrameBytes: 8,
        maxQueuedBytes: 16,
      });
      const opening = transport.open();
      socket.emit("open");
      await opening;
      if (mode === "half-close") socket.readyState = 2;
      else socket.sendFailure = mode;

      await assert.rejects(transport.send(new Uint8Array([1])), /failed|scripted|not open/u);
      assert.equal(transport.state, "failed");
      assert.equal(socket.closeCount, 1);
      await assert.rejects(transport.send(new Uint8Array([2])), /failed/u);
    });
  }
});

test("WebSocketByteTransport aborts a backpressure wait without failing", async () => {
  const socket = new LifecycleWebSocket();
  const transport = new WebSocketByteTransport({
    origin: "http://127.0.0.1:4317",
    authToken: "pairing-token-123456",
    WebSocket: function FakeWebSocketConstructor() { return socket; },
    maxFrameBytes: 8,
    maxQueuedBytes: 16,
  });
  const opening = transport.open();
  socket.emit("open");
  await opening;
  socket.bufferedAmount = 16;
  const controller = new AbortController();
  const waiting = transport.waitForWritable(1, controller.signal);
  controller.abort(new Error("scripted abort"));
  await assert.rejects(waiting, /scripted abort/u);
  assert.equal(transport.state, "open");
  await transport.close();
});

class LifecycleWebSocket {
  readyState = 1;
  bufferedAmount = 0;
  sendFailure = undefined;
  closeCount = 0;
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }
  send(_data, callback) {
    if (this.sendFailure === "throw") throw new Error("scripted send failure");
    callback(this.sendFailure === "callback" ? new Error("scripted send failure") : undefined);
  }
  close() {
    this.closeCount += 1;
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "" });
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
