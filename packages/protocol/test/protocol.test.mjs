import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROTOCOL_LIMITS, CommandLedger, FrameKind, encodeCanonicalJson, decodeCanonicalJson,
  encodeFrame, decodeFrame, negotiateClientHello, negotiateVersion, validateEnvelope,
} from "../dist/index.js";

const hello = {
  type: "client_hello", protocolMin: 1, protocolMax: 1, clientId: "client-a", clientVersion: "1.0.0",
  capabilities: ["workspace.read"], limits: { maxFrameBytes: 1024 * 1024 },
};
const command = {
  type: "command", commandId: "command-a", correlationId: "query-a", operation: "workspace.rename",
  payload: { title: "hello" }, expectedRevision: 3, deadlineMs: 5000,
};

test("canonical JSON is stable and rejects duplicates, unknown/non-canonical order, and invalid UTF-8", () => {
  const bytes = encodeCanonicalJson({ b: 2, a: "x" });
  assert.equal(new TextDecoder().decode(bytes), '{"a":"x","b":2}');
  assert.deepEqual(decodeCanonicalJson(bytes), { a: "x", b: 2 });
  assert.throws(() => decodeCanonicalJson(new TextEncoder().encode('{"a":1,"a":2}')), /duplicate/);
  assert.throws(() => decodeCanonicalJson(new TextEncoder().encode('{"b":2,"a":1}')), /canonical/);
  assert.throws(() => decodeCanonicalJson(new Uint8Array([0xff])), /UTF-8/);
  assert.throws(() => encodeCanonicalJson({ value: undefined }), /undefined/);
  assert.throws(() => encodeCanonicalJson({ value: Infinity }), /finite/);
});

test("frames enforce magic, kind, lengths, canonical headers, and bounded bodies", () => {
  const frame = encodeFrame(command, new Uint8Array([1, 2, 3]));
  assert.equal(frame[5], FrameKind.Command);
  const decoded = decodeFrame(frame);
  assert.deepEqual(decoded.envelope, command);
  assert.deepEqual(decoded.body, new Uint8Array([1, 2, 3]));
  const badMagic = frame.slice(); badMagic[0] = 0;
  assert.throws(() => decodeFrame(badMagic), /magic/);
  const badKind = frame.slice(); badKind[5] = FrameKind.Event;
  assert.throws(() => decodeFrame(badKind), /kind/);
  const oversized = new Uint8Array(frame); new DataView(oversized.buffer).setUint32(10, 0xffffffff, false);
  assert.throws(() => decodeFrame(oversized), /limit|length/);
  assert.throws(() => encodeFrame(command, new Uint8Array(DEFAULT_PROTOCOL_LIMITS.maxBodyBytes + 1)), /body/);
});

test("closed envelope validation rejects extra fields and inconsistent result status", () => {
  assert.deepEqual(validateEnvelope(hello), hello);
  assert.throws(() => validateEnvelope({ ...hello, injected: true }), /unknown/);
  assert.throws(() => validateEnvelope({ type: "query_result", queryId: "q", ok: true, error: { code: "internal", message: "no" } }), /error/);
  assert.throws(() => validateEnvelope({ ...command, operation: "../escape" }), /operation/);
  assert.throws(() => validateEnvelope({ ...command, deadlineMs: 0 }), /deadline/);
});

test("version negotiation fails closed and command completion is idempotent", () => {
  assert.equal(negotiateVersion(1, 2), 1);
  assert.throws(() => negotiateVersion(0, 0), /incompatible/);
  const priorVersionFixture = { type: "client_hello", protocolMin: 0, protocolMax: 0, clientId: "prior-client", clientVersion: "0.9.0", capabilities: [], limits: {} };
  assert.throws(() => negotiateVersion(priorVersionFixture.protocolMin, priorVersionFixture.protocolMax), /incompatible/);
  const ledger = new CommandLedger();
  assert.deepEqual(ledger.begin("command-a"), { kind: "new" });
  const result = { type: "command_result", commandId: "command-a", correlationId: "query-a", ok: true, result: { revision: 4 }, revision: 4 };
  ledger.complete(result);
  assert.deepEqual(ledger.begin("command-a"), { kind: "completed", result });
  assert.deepEqual(ledger.status("command-a"), result);
});

test("default protocol limits negotiate without exceeding the frame envelope", () => {
  const negotiated = negotiateClientHello({
    type: "client_hello",
    protocolMin: 1,
    protocolMax: 1,
    clientId: "client-default",
    clientVersion: "1.0.0",
    capabilities: [],
    limits: DEFAULT_PROTOCOL_LIMITS,
  }, []);
  assert.equal(negotiated.limits.maxHeaderBytes + negotiated.limits.maxBodyBytes + 14 <= negotiated.limits.maxFrameBytes, true);
});
