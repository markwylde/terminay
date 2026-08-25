import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAgentObservationBytes,
  parseObservedJson,
  parseObservedJsonLine,
} from "../dist/extensions/child.js";
import { jsonIpcValue } from "../dist/extensions/protocol.js";

test("the extension child restores typed file reads from JSON-safe IPC bytes", () => {
  const encoded = [...new TextEncoder().encode('{"type":"session_meta","payload":{"id":"root"}}\n{"type":"later"}\n')];
  const bytes = decodeAgentObservationBytes(encoded);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(parseObservedJsonLine(bytes, "first"), {
    type: "session_meta",
    payload: { id: "root" },
  });
  assert.deepEqual(parseObservedJsonLine(bytes, "last"), { type: "later" });
  assert.deepEqual(parseObservedJson(decodeAgentObservationBytes([...new TextEncoder().encode('{"ok":true}')])) , { ok: true });
});

test("the extension child rejects malformed and oversized file-byte transports", () => {
  assert.throws(() => decodeAgentObservationBytes([0, -1]), /invalid bytes/);
  assert.throws(() => decodeAgentObservationBytes(new Array(4 * 1024 * 1024 + 1).fill(0)), /byte limit/);
  assert.equal(parseObservedJson(new Uint8Array([123])), undefined);
  assert.equal(parseObservedJsonLine(new TextEncoder().encode("not-json\n"), "first"), undefined);
});

test("observation IPC payloads drop AbortSignal so Electron child send cannot fail closed", () => {
  const payload = jsonIpcValue({
    contextId: "ctx-1",
    operation: "process.descendants",
    payload: { signal: new AbortController().signal, access: "writable" },
  });
  assert.deepEqual(payload, {
    contextId: "ctx-1",
    operation: "process.descendants",
    payload: { access: "writable" },
  });
  assert.doesNotThrow(() => JSON.stringify(payload));
});
