import test from "node:test";
import assert from "node:assert/strict";
import { FramedIpcTransport } from "../dist/compatibility/framedIpcTransport.js";

function ports() {
  const a = { onmessage: null, onmessageerror: null, postMessage(value) { queueMicrotask(() => b.onmessage?.({ data: value })); }, start() {}, close() {} };
  const b = { onmessage: null, onmessageerror: null, postMessage(value) { queueMicrotask(() => a.onmessage?.({ data: value })); }, start() {}, close() {} };
  return [a, b];
}

test("framed IPC adapter bounds and copies MessagePort frames", async () => {
  const [aPort, bPort] = ports();
  const a = new FramedIpcTransport(aPort, { maxQueuedBytes: 64 });
  const b = new FramedIpcTransport(bPort, { maxQueuedBytes: 64 });
  await Promise.all([a.open(), b.open()]);
  const frame = new Uint8Array([1, 2, 3]);
  await a.send(frame);
  frame[0] = 9;
  const received = await b.incoming[Symbol.asyncIterator]().next();
  assert.deepEqual([...received.value], [1, 2, 3]);
  await Promise.all([a.close(), b.close()]);
});
