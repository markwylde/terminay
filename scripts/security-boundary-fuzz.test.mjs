import assert from "node:assert/strict";
import test from "node:test";
import {
  ABSOLUTE_PROTOCOL_LIMITS,
  decodeCanonicalJson,
  decodeFrame,
  encodeFrame,
  negotiateVersion,
  validateEnvelope,
  validateLimits,
  validateTransportFrame,
} from "@terminay/protocol";
import { ControlFrameDecoder } from "../apps/terminay-server/dist/mcp/controlEndpoint.js";
import { RemoteConnectionManager, validateUiBundleManifest } from "@terminay/server-core";

function randomBytes(seed, length) {
  let state = seed >>> 0;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function assertRejectsOnlyWithErrors(work) {
  try { work(); }
  catch (error) { assert.ok(error instanceof Error, "validators must throw Error instances"); }
}

test("protocol, local-control, transport, and UI-bundle validators survive deterministic fuzz inputs", () => {
  const valid = encodeFrame({ type: "query", queryId: "fuzz-query", operation: "workspace.snapshot", payload: {} });
  for (let seed = 1; seed <= 2_000; seed += 1) {
    const length = seed % 3 === 0 ? seed % 4096 : seed % 128;
    const bytes = randomBytes(seed, length);
    if (seed % 17 === 0) bytes.set(valid.slice(0, Math.min(valid.byteLength, bytes.byteLength)));
    assertRejectsOnlyWithErrors(() => decodeFrame(bytes));
    assertRejectsOnlyWithErrors(() => decodeCanonicalJson(bytes));
    assertRejectsOnlyWithErrors(() => validateTransportFrame(bytes, 64 * 1024));
    const decoder = new ControlFrameDecoder(64 * 1024, 8);
    assertRejectsOnlyWithErrors(() => decoder.push(bytes));

    // Exercise the object validators with a small deterministic shape budget.
    // Rejections must remain ordinary Error instances at an untrusted
    // transport boundary; no assertion or non-error value may escape.
    const candidate = seed % 5 === 0
      ? { type: "query", queryId: `q-${seed}`, operation: "workspace.snapshot", payload: { seed } }
      : seed % 5 === 1
        ? { type: "client_hello", protocolMin: seed, protocolMax: seed - 1, clientId: "client", clientVersion: "fuzz", capabilities: [], limits: {} }
        : seed % 5 === 2
          ? { type: "error", error: { code: "internal", message: "fuzz" } }
          : seed % 5 === 3
            ? { limits: { maxFrameBytes: seed, unknown: seed } }
            : null;
    assertRejectsOnlyWithErrors(() => validateEnvelope(candidate));
    assertRejectsOnlyWithErrors(() => validateLimits(candidate?.limits ?? candidate, ABSOLUTE_PROTOCOL_LIMITS));
    assertRejectsOnlyWithErrors(() => negotiateVersion(seed, seed - 1));
  }

  const decoder = new ControlFrameDecoder(64 * 1024, 8);
  assert.deepEqual(decoder.push(new TextEncoder().encode('{"id":"x"')),
    []);
  assertRejectsOnlyWithErrors(() => decoder.push(new TextEncoder().encode("x".repeat(70_000))));
  assertRejectsOnlyWithErrors(() => decoder.finish());
  assertRejectsOnlyWithErrors(() => validateUiBundleManifest({ schemaVersion: 1, bundleId: "../../escape", assets: [], entryPath: "/" }));
});

test("remote admission rejects fuzzed identity/proof shapes without creating peers", () => {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    maxPeers: 4,
  });
  manager.expose(1_000);
  const malformed = [null, undefined, 0, "proof", [], { authenticated: true }, { authenticated: true, serverId: "server-a" }];
  for (const proof of malformed) assertRejectsOnlyWithErrors(() => manager.admit(proof));
  for (let seed = 1; seed <= 512; seed += 1) {
    now = 100 + seed;
    const proof = {
      ticketId: `ticket-${seed}`,
      serverId: seed % 2 === 0 ? "forged-server" : "server-a",
      sessionOrigin: seed % 2 === 0 ? "https://session.example.test" : "https://evil.example.test",
      deviceId: `device-${seed}`,
      expiresAt: seed % 7 === 0 ? Number.NaN : 900,
      authenticated: true,
    };
    assertRejectsOnlyWithErrors(() => manager.admit(proof));
  }
  assert.equal(manager.snapshot().peers.length, 0);
});
