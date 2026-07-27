import assert from "node:assert/strict";
import test from "node:test";
import { decodeFrame, encodeFrame } from "@terminay/protocol";
import { createDesktopIpcClient, ServerScopedIpcMessagePort } from "../dist/index.js";

function ports() {
  const packets = [];
  const a = { onmessage: null, onmessageerror: null, postMessage(value) { packets.push(["a", value]); queueMicrotask(() => b.onmessage?.({ data: clone(value) })); }, start() {}, close() {} };
  const b = { onmessage: null, onmessageerror: null, postMessage(value) { packets.push(["b", value]); queueMicrotask(() => a.onmessage?.({ data: clone(value) })); }, start() {}, close() {} };
  return { a, b, packets };
}

function clone(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const packet = value;
  return { ...packet, ...(packet.frame instanceof Uint8Array ? { frame: packet.frame.slice() } : {}) };
}

const serverHello = {
  type: "server_hello",
  protocolVersion: 1,
  serverId: "server-a",
  serverVersion: "1.0.0",
  clientId: "client-a",
  capabilities: [],
  limits: {},
  authScope: "admin",
};

test("Desktop IPC compatibility client keeps one server scope through shared TerminayClient", async () => {
  const { a, b, packets } = ports();
  const server = new ServerScopedIpcMessagePort(b, "server-a");
  const received = [];
  server.onmessage = (event) => {
    const decoded = decodeFrame(event.data);
    received.push(decoded.envelope);
    if (decoded.envelope.type === "client_hello") server.postMessage(encodeFrame(serverHello));
  };
  const client = createDesktopIpcClient({ port: a, serverId: "server-a", clientId: "client-a" });
  const hello = await client.connect();
  assert.equal(hello.serverId, "server-a");
  assert.equal(received[0].type, "client_hello");
  assert.equal(packets[0][0], "a");
  assert.equal(packets[0][1].serverId, "server-a");
  assert.equal("port" in client, false, "renderer receives only the shared client, not a raw port authority");
  await client.close();
});

test("Desktop IPC compatibility client rejects an inbound frame for another server", async () => {
  const { a, b } = ports();
  b.onmessage = (event) => {
    const packet = event.data;
    if (packet?.type === "terminay.server-frame") b.postMessage({ type: "terminay.server-frame", version: 1, serverId: "server-other", frame: encodeFrame(serverHello) });
  };
  const client = createDesktopIpcClient({ port: a, serverId: "server-a", clientId: "client-a" });
  await assert.rejects(client.connect(), /transport disconnected|handshake/);
});

test("scoped IPC port reports malformed or mismatched packets instead of forwarding them", async () => {
  const { a, b } = ports();
  const scoped = new ServerScopedIpcMessagePort(a, "server-a");
  let errors = 0;
  scoped.onmessageerror = () => { errors += 1; };
  b.postMessage({ type: "terminay.server-frame", version: 1, serverId: "server-other", frame: new Uint8Array([1]) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors, 1);
});
