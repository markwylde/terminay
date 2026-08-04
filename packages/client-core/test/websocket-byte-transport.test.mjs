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
